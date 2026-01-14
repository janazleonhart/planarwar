// worldcore/npc/NpcSpawnController.ts

/**
 * Coordinates shared NPC spawns and personal resource nodes from DB-backed
 * spawn_points. Dedupe is derived from *live entities* in the room so that:
 *  - refresh is idempotent
 *  - missing/despawned shared NPCs can be replaced
 *  - personal nodes are per-owner and can rehydrate safely
 */

import { EntityManager } from "../core/EntityManager";
import type { CharacterState } from "../characters/CharacterTypes";
import { isNodeAvailable } from "../progression/ProgressionCore";
import { Logger } from "../utils/logger";
import { DbSpawnPoint, SpawnPointService } from "../world/SpawnPointService";
import { upsertSpawnPoint } from "../world/SpawnPointCache";
import { getNpcPrototype } from "./NpcTypes";
import { NpcManager } from "./NpcManager";

const log = Logger.scope("NPC_SPAWN");

function isResourceProto(protoId: string): boolean {
  const proto = getNpcPrototype(protoId);
  const tags = proto?.tags ?? [];
  return tags.includes("resource") || tags.some((t) => t.startsWith("resource_"));
}

export class NpcSpawnController {
  constructor(
    private readonly deps: {
      spawnPoints: SpawnPointService;
      npcs: NpcManager;
      entities: EntityManager;
    },
  ) {}

  async spawnFromRegion(shardId: string, regionId: string, roomId: string): Promise<number> {
    const points = await this.deps.spawnPoints.getSpawnPointsForRegion(shardId, regionId);
    return this.spawnSharedNpcsFromPoints(points, roomId);
  }

  async spawnNear(
    shardId: string,
    x: number,
    z: number,
    radius: number,
    roomId: string,
  ): Promise<number> {
    const points = await this.deps.spawnPoints.getSpawnPointsNear(shardId, x, z, radius);
    return this.spawnSharedNpcsFromPoints(points, roomId);
  }

  async spawnPersonalNodesForRegion(
    shardId: string,
    regionId: string,
    roomId: string,
    ownerSessionId: string,
    char: CharacterState,
  ): Promise<number> {
    const key = `personal:${roomId}:${ownerSessionId}`;
    if (this.personalSpawnInFlight.has(key)) return 0;

    this.personalSpawnInFlight.add(key);
    try {
      const points = await this.deps.spawnPoints.getSpawnPointsForRegion(shardId, regionId);
      return this.spawnPersonalNodesFromPoints(points, roomId, ownerSessionId, char);
    } finally {
      this.personalSpawnInFlight.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Shared NPC spawns
  // ---------------------------------------------------------------------------

  private spawnSharedNpcsFromPoints(points: DbSpawnPoint[], roomId: string): number {
    let spawned = 0;

    // Dedupe from LIVE entities currently in the room.
    const existing = new Set<number>();
    const ents = this.deps.entities.getEntitiesInRoom(roomId);
    for (const e of ents as any[]) {
      const spid = (e as any)?.spawnPointId;
      if (typeof spid === "number") existing.add(spid);
    }

    for (const p of points) {
      // Only NPC-like types here
      const t = String(p.type || "").toLowerCase();
      const isNpcType = t === "npc" || t === "mob" || t === "creature";
      if (!isNpcType) continue;

      // CRITICAL: never spawn resource prototypes as shared NPCs.
      if (isResourceProto(p.protoId)) continue;

      if (existing.has(p.id)) continue;

      // Warm cache for respawn/home logic.
      upsertSpawnPoint(p);

      const px = p.x ?? 0;
      const py = p.y ?? 0;
      const pz = p.z ?? 0;

      const state = this.deps.npcs.spawnNpcById(p.protoId, roomId, px, py, pz, p.variantId);
      if (!state) {
        log.warn("Failed to spawn NPC from spawn point", {
          spawnPointId: p.id,
          protoId: p.protoId,
          variantId: p.variantId,
          type: p.type,
        });
        continue;
      }

      const e: any = this.deps.npcs.getEntity?.(state.entityId) ?? this.deps.entities.get(state.entityId);
      if (e) {
        // Spawn metadata required by contracts + respawn logic.
        e.spawnPointId = p.id;
        e.spawnId = p.spawnId;
        e.regionId = p.regionId;

        // Immutable spawn/home coords (separate from mutable x/y/z).
        e.spawnX = px;
        e.spawnY = py;
        e.spawnZ = pz;
      }

      existing.add(p.id);
      spawned++;
    }

    return spawned;
  }

  // ---------------------------------------------------------------------------
  // Personal nodes
  // ---------------------------------------------------------------------------

  private personalSpawnInFlight = new Set<string>();

  private spawnPersonalNodesFromPoints(
    points: DbSpawnPoint[],
    roomId: string,
    ownerSessionId: string,
    char: CharacterState,
  ): number {
    let spawned = 0;

    // Dedupe from LIVE entities currently in the room for this owner.
    const existing = new Set<number>();
    const ents = this.deps.entities.getEntitiesInRoom(roomId);
    for (const e of ents as any[]) {
      if (!e) continue;
      if ((e.type !== "node" && e.type !== "object") || e.ownerSessionId !== ownerSessionId) continue;
      const spid = (e as any).spawnPointId;
      if (typeof spid === "number") existing.add(spid);
    }

    for (const p of points) {
      if (existing.has(p.id)) continue;

      const t = String(p.type || "").toLowerCase();
      const isNodeType = t === "node" || t === "resource";
      const isResource = isNodeType || isResourceProto(p.protoId);
      if (!isResource) continue;

      // Per-character depletion filter (coerce spawnPoint id defensively).
      const spawnPointNum = typeof (p as any).id === "number" ? (p as any).id : Number((p as any).id);
      if (!Number.isFinite(spawnPointNum)) continue;

      if (!isNodeAvailable(char, spawnPointNum)) continue;

      upsertSpawnPoint(p);

      const px = p.x ?? 0;
      const py = p.y ?? 0;
      const pz = p.z ?? 0;

      const st = this.deps.npcs.spawnNpcById(p.protoId, roomId, px, py, pz, p.variantId);
      if (!st) continue;

      const e: any = this.deps.npcs.getEntity?.(st.entityId) ?? this.deps.entities.get(st.entityId);

      // Absolute paranoia: never tag a player as a node
      if (e && e.type === "player") {
        log.error("BUG: attempted to tag a player entity as a node", {
          entityId: st.entityId,
          ownerSessionId,
          spawnPointId: p.id,
          protoId: p.protoId,
          entityName: e.name,
        });
        // Clean up the spawned npc/entity to avoid corrupt state
        this.deps.npcs.despawnNpc(st.entityId);
        continue;
      }

      // Tag entity as personal node with spawn metadata (contracts require this).
      if (e) {
        e.type = "node";
        e.ownerSessionId = ownerSessionId;

        e.spawnPointId = p.id;
        e.spawnId = p.spawnId;
        e.regionId = p.regionId;

        e.spawnX = px;
        e.spawnY = py;
        e.spawnZ = pz;

        // Helpful for later debugging / tools
        (e as any).protoId = p.protoId;
      } else {
        log.warn("Spawned node but failed to tag entity for ownership", {
          entityId: st.entityId,
          spawnPointId: p.id,
          ownerSessionId,
          protoId: p.protoId,
        });
      }

      existing.add(p.id);
      spawned++;
    }

    return spawned;
  }

  async spawnPersonalNodesFromRegion(
    shardId: string,
    regionId: string,
    roomId: string,
    ownerSessionId: string,
    char: CharacterState,
  ): Promise<number> {
    return this.spawnPersonalNodesForRegion(shardId, regionId, roomId, ownerSessionId, char);
  }
}
