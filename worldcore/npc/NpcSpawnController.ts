// worldcore/npc/NpcSpawnController.ts

import { NpcManager } from "./NpcManager";
import { SpawnPointService, DbSpawnPoint } from "../world/SpawnPointService";
import { Logger } from "../utils/logger";
import { isNodeAvailable } from "../progression/ProgressionCore";
import { getNpcPrototype } from "./NpcTypes";
import { EntityManager } from "../core/EntityManager";

import type { CharacterState } from "../characters/CharacterTypes";

const log = Logger.scope("NPC_SPAWN");

function isResourceProto(protoId: string): boolean {
  const proto = getNpcPrototype(protoId);
  const tags = proto?.tags ?? [];
  return tags.includes("resource") || tags.some((t) => t.startsWith("resource_"));
}

export class NpcSpawnController {
  constructor(
    private readonly spawnPoints: SpawnPointService,
    private readonly npcs: NpcManager,
    private readonly entities: EntityManager
  ) {}

  // Dedupe must be scoped:
  // - shared NPCs: shared:<roomId>
  // - personal nodes: personal:<roomId>:<ownerSessionId>
  private spawnedSpawnPointIdsByScope = new Map<string, Set<number>>();

  private getDedupeSet(scopeKey: string): Set<number> {
    let set = this.spawnedSpawnPointIdsByScope.get(scopeKey);
    if (!set) {
      set = new Set<number>();
      this.spawnedSpawnPointIdsByScope.set(scopeKey, set);
    }
    return set;
  }

  async spawnFromRegion(shardId: string, regionId: string, roomId: string): Promise<number> {
    const points = await this.spawnPoints.getSpawnPointsForRegion(shardId, regionId);
    return this.spawnSharedNpcsFromPoints(points, roomId);
  }

  async spawnNear(
    shardId: string,
    x: number,
    z: number,
    radius: number,
    roomId: string
  ): Promise<number> {
    const points = await this.spawnPoints.getSpawnPointsNear(shardId, x, z, radius);
    return this.spawnSharedNpcsFromPoints(points, roomId);
  }

  async spawnPersonalNodesFromRegion(
    shardId: string,
    regionId: string,
    roomId: string,
    ownerSessionId: string,
    char: CharacterState
  ): Promise<number> {
    const key = `personal:${roomId}:${ownerSessionId}`;
    if (this.personalSpawnInFlight.has(key)) return 0;

    this.personalSpawnInFlight.add(key);
    try {
      const points = await this.spawnPoints.getSpawnPointsForRegion(shardId, regionId);
      return this.spawnPersonalNodesFromPoints(points, roomId, ownerSessionId, char);
    } finally {
      this.personalSpawnInFlight.delete(key);
    }
  }

  private spawnSharedNpcsFromPoints(points: DbSpawnPoint[], roomId: string): number {
    let spawned = 0;
    const dedupe = this.getDedupeSet(`shared:${roomId}`);

    for (const p of points) {
      if (dedupe.has(p.id)) continue;

      const t = String(p.type || "").toLowerCase();

      // Only NPC-like types here
      const isNpcType = t === "npc" || t === "mob" || t === "creature";
      if (!isNpcType) continue;

      // CRITICAL: never spawn resource prototypes as shared NPCs
      // Even if DB type incorrectly says "npc", resources must be personal nodes.
      if (isResourceProto(p.protoId)) {
        continue;
      }

      const px = p.x ?? 0;
      const py = p.y ?? 0;
      const pz = p.z ?? 0;

      const state = this.npcs.spawnNpcById(p.protoId, roomId, px, py, pz, p.variantId);
      if (!state) {
        log.warn("Failed to spawn NPC from spawn point", {
          spawnPointId: p.id,
          protoId: p.protoId,
          variantId: p.variantId,
          type: p.type,
        });
        continue;
      }

      dedupe.add(p.id);
      spawned++;
    }

    return spawned;
  }

  private personalSpawnInFlight = new Set<string>();

  private spawnPersonalNodesFromPoints(
    points: DbSpawnPoint[],
    roomId: string,
    ownerSessionId: string,
    char: CharacterState
  ): number {
    let spawned = 0;
  
    // Build a fast lookup of already-present personal nodes in this room for this owner
    const existing = new Set<number>();
    // NEW v0.9: use EntityManager directly
    const ents = this.entities.getEntitiesInRoom(roomId);
    for (const e of ents) {
      if (!e) continue;
      if (e.type !== "node" && e.type !== "object") continue;
      if (e.ownerSessionId !== ownerSessionId) continue;
      if (typeof (e as any).spawnPointId !== "number") continue;
      existing.add((e as any).spawnPointId);
    }
  
    for (const p of points) {
      // Already spawned and still alive in-world → skip
      if (existing.has(p.id)) continue;
  
      const t = String(p.type || "").toLowerCase();
      const isNodeType = t === "node" || t === "resource";
      const isResource = isNodeType || isResourceProto(p.protoId);
      if (!isResource) continue;
  
      // Per-character depletion filter
      if (!isNodeAvailable(char, p.id)) continue;
  
      const px = p.x ?? 0;
      const py = p.y ?? 0;
      const pz = p.z ?? 0;
  
      const st = this.npcs.spawnNpcById(p.protoId, roomId, px, py, pz, p.variantId);
      if (!st) continue;
  
      const e =
        (this.npcs as any).getEntity?.(st.entityId) ??
        (this.npcs as any).entities?.get?.(st.entityId);
  
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
        this.npcs.despawnNpc(st.entityId);
        continue;
      }
  
      // Tag entity as personal node with spawn metadata
      if (e) {
        e.type = "node";
        e.ownerSessionId = ownerSessionId;
        (e as any).spawnPointId = p.id;
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
    
}
