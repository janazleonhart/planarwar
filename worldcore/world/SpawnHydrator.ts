// worldcore/world/SpawnHydrator.ts
// -----------------------------------------------------------------------------
// Purpose:
// Dev-safe "rehydration" of DB-backed spawn_points into runtime entities.
// This is intentionally conservative:
// - Spawns only inert POI-like placeholders (outposts, checkpoints, graveyards…)
// - Does NOT spawn mobs/resources (NpcSpawnController owns that domain)
// - Designed to be triggered via `nearby` (region-sensitive) or debug commands
//
// Enable auto-hydration via env flag:
//   WORLD_SPAWNS_ENABLED=1
// Optional filter:
//   WORLD_SPAWNS_TYPES=outpost,checkpoint,graveyard,town
//
// Optional town baselines:
//   PW_TOWN_BASELINES=1 (or WORLD_TOWN_BASELINES=1)
// -----------------------------------------------------------------------------

import { Logger } from "../utils/logger";
import type { EntityManager } from "../core/EntityManager";
import type { Entity } from "../shared/Entity";
import type { DbSpawnPoint, SpawnPointService } from "./SpawnPointService";
import { TownBaselines } from "./TownBaselines";

const log = Logger.scope("SpawnHydrator");

export type SpawnHydratorOptions = {
  /**
   * If provided, only these spawn_point types will be considered.
   * If omitted, defaults to a conservative POI allowlist.
   */
  allowTypes?: string[];
};

export type RehydrateRoomArgs = {
  shardId: string;
  regionId: string; // spawn_points.region_id (e.g. "prime_shard:0,0")
  roomId: string;   // session.roomId (often constant in current runtime)
  dryRun?: boolean;
  force?: boolean; // ignore per-region cache
};

export type RehydrateRoomResult = {
  shardId: string;
  regionId: string;
  roomId: string;
  total: number;
  eligible: number;
  skippedExisting: number;
  spawned: number;
  wouldSpawn: number; // dryRun only
};

function parseCsvEnv(v: string | undefined | null): string[] | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function titleCase(s: string): string {
  const x = String(s ?? "").trim();
  if (!x) return "POI";
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function normalizeType(t: string): string {
  return String(t ?? "").trim().toLowerCase();
}

/**
 * Conservative default: only obvious "places" or "landmarks".
 * These render nicely in `nearby` and should not behave like combat mobs.
 */
const DEFAULT_ALLOWED_TYPES = [
  "checkpoint",
  "graveyard",

  // Town/service anchors (inert POIs; safe by default)
  "mailbox",
  "rest",
  "station",

  "outpost",
  "town",
  "hub",
  "village",
  "city",
  "settlement",
  "camp",
];

const ALWAYS_EXCLUDED_TYPES = new Set([
  // Owned by NpcSpawnController (mobs + gather nodes)
  "npc",
  "mob",
  "creature",
  "node",
  "object",
  "resource",
]);

function computePoiName(sp: DbSpawnPoint): string {
  const type = normalizeType(sp.type);
  const protoId = String(sp.protoId ?? (sp as any).archetype ?? "").trim();

  if (type === "mailbox") return "Mailbox";
  if (type === "rest") return "Rest Spot";

  if (type === "station") {
    const pid = protoId.toLowerCase();
    if (pid.includes("forge")) return "Forge";
    if (pid.includes("alchemy")) return "Alchemy Table";
    if (pid.includes("oven")) return "Oven";
    if (pid.includes("mill")) return "Millstone";
    if (pid.includes("workbench")) return "Workbench";
    return protoId
      ? titleCase(protoId.replace(/^station_/, "").replace(/_/g, " "))
      : "Crafting Station";
  }

  const t = titleCase(sp.type);
  const id = String(sp.spawnId ?? "").trim();
  if (!id) return t;
  return `${t} (${id})`;
}

function entityAlreadyRepresentsSpawnPoint(e: Entity, sp: DbSpawnPoint): boolean {
  // Most robust: spawnPointId match
  const a: any = e as any;
  if (typeof a.spawnPointId === "number" && typeof sp.id === "number") {
    if (a.spawnPointId === sp.id) return true;
  }

  // Fallback: type + proto + near-coords
  if (normalizeType(e.type) === normalizeType(sp.type)) {
    const protoA = String(a.protoId ?? a.model ?? "").trim();
    const protoB = String(sp.protoId ?? (sp as any).archetype ?? "").trim();
    if (protoA && protoB && protoA === protoB) {
      const dx = Math.abs((e.x ?? 0) - (sp.x ?? 0));
      const dz = Math.abs((e.z ?? 0) - (sp.z ?? 0));
      if (dx < 0.1 && dz < 0.1) return true;
    }
  }

  return false;
}

export class SpawnHydrator {
  /**
   * Cache is PER REGION (not room), because the current runtime keeps roomId
   * stable while regionId changes as you move.
   */
  private hydratedRegionKeys = new Set<string>();

  private allowTypes: string[];
  private townBaselines: TownBaselines;

  constructor(
    private spawnPoints: SpawnPointService,
    private entities: EntityManager,
    opts?: SpawnHydratorOptions,
  ) {
    const envAllow = parseCsvEnv(process.env.WORLD_SPAWNS_TYPES);
    const initial = envAllow ?? opts?.allowTypes ?? DEFAULT_ALLOWED_TYPES;
    this.allowTypes = initial.map(normalizeType).filter(Boolean);

    // Optional: town service baselines (e.g., mailbox anchors)
    this.townBaselines = new TownBaselines(this.entities);
  }

  /**
   * Rehydrate POI-like spawn_points for a region into the current room.
   * Returns a summary so callers can log/report it.
   */
  async rehydrateRoom(args: RehydrateRoomArgs): Promise<RehydrateRoomResult> {
    const { shardId, regionId, roomId, dryRun, force } = args;

    const key = `${shardId}:${regionId}`;

    // If we already hydrated this region and caller didn't force,
    // we still give town baselines a chance to run (safe no-op if disabled).
    if (!force && this.hydratedRegionKeys.has(key)) {
      try {
        const wantTownBaselines =
          process.env.PW_TOWN_BASELINES === "1" ||
          process.env.WORLD_TOWN_BASELINES === "1";

        if (wantTownBaselines && this.townBaselines?.enabled) {
          const rows = await this.spawnPoints.getSpawnPointsForRegion(shardId, regionId);
          for (const sp of rows) {
            this.townBaselines.ensureTownBaseline({
              shardId,
              regionId,
              roomId,
              townSpawn: sp,
              dryRun,
            });
          }
        }
      } catch (err: any) {
        log.warn("Town baselines ensure failed", { shardId, regionId, err });
      }

      return {
        shardId,
        regionId,
        roomId,
        total: 0,
        eligible: 0,
        skippedExisting: 0,
        spawned: 0,
        wouldSpawn: 0,
      };
    }

    let rows: DbSpawnPoint[] = [];
    try {
      rows = await this.spawnPoints.getSpawnPointsForRegion(shardId, regionId);
    } catch (err) {
      log.warn("spawn_points region query failed", { shardId, regionId, roomId, err });
      return {
        shardId,
        regionId,
        roomId,
        total: 0,
        eligible: 0,
        skippedExisting: 0,
        spawned: 0,
        wouldSpawn: 0,
      };
    }

    const total = rows.length;

    const eligibleRows = rows.filter((sp) => {
      const t = normalizeType(sp.type);
      if (!t) return false;
      if (ALWAYS_EXCLUDED_TYPES.has(t)) return false;
      if (this.allowTypes.length > 0 && !this.allowTypes.includes(t)) return false;
      return true;
    });

    const inRoom = this.entities.getEntitiesInRoom(roomId) ?? [];
    let skippedExisting = 0;
    let spawned = 0;
    let wouldSpawn = 0;

    for (const sp of eligibleRows) {
      // Town baselines (mailbox anchors, etc.) run regardless of whether we spawn the POI this call.
      try {
        const wantTownBaselines =
          process.env.PW_TOWN_BASELINES === "1" ||
          process.env.WORLD_TOWN_BASELINES === "1";

        if (wantTownBaselines && this.townBaselines.enabled) {
          this.townBaselines.ensureTownBaseline({ shardId, regionId, roomId, townSpawn: sp, dryRun });
        }
      } catch (err: any) {
        log.warn("Town baselines ensure failed", { shardId, regionId, err });
      }

      const already = inRoom.some((e) => entityAlreadyRepresentsSpawnPoint(e, sp));
      if (already) {
        skippedExisting++;
        continue;
      }

      if (dryRun) {
        wouldSpawn++;
        continue;
      }

      // EntityManager factory we actually have today:
      // createNpcEntity(roomId, model) -> returns an Entity placed into the room.
      const model = String(sp.protoId ?? (sp as any).archetype ?? sp.type ?? "poi");
      const ent = this.entities.createNpcEntity(roomId, model);

      // Convert it into an inert POI-ish thing.
      ent.type = normalizeType(sp.type) || "poi";
      ent.name = computePoiName(sp);

      ent.x = sp.x ?? 0;
      ent.y = sp.y ?? 0;
      ent.z = sp.z ?? 0;

      // DB linkage
      (ent as any).spawnPointId = sp.id;
      (ent as any).protoId = sp.protoId ?? null;
      (ent as any).variantId = sp.variantId ?? null;
      (ent as any).spawnType = sp.type;

      // Service protection + helpful tags for inert town services
      if (ent.type === "mailbox" || ent.type === "rest" || ent.type === "station") {
        (ent as any).isServiceProvider = true;
        (ent as any).isProtectedService = true;
        (ent as any).immuneToDamage = true;
        (ent as any).noAttack = true;

        const tags = new Set<string>(Array.isArray((ent as any).tags) ? (ent as any).tags : []);
        tags.add("service");
        tags.add("protected_service");
        tags.add(ent.type);

        if (ent.type === "station") {
          tags.add("craft_station");
          const pid = String((ent as any).protoId ?? "").trim();
          if (pid) tags.add(pid);
        }

        (ent as any).tags = [...tags];
      }

      // Ensure it doesn't get misclassified as a personal node or player-like entity
      delete (ent as any).ownerSessionId;

      spawned++;
    }

    this.hydratedRegionKeys.add(key);

    if (!dryRun && (spawned > 0 || skippedExisting > 0)) {
      log.info("Rehydrated POIs for region", {
        shardId,
        regionId,
        roomId,
        total,
        eligible: eligibleRows.length,
        spawned,
        skippedExisting,
      });
    }

    return {
      shardId,
      regionId,
      roomId,
      total,
      eligible: eligibleRows.length,
      skippedExisting,
      spawned,
      wouldSpawn,
    };
  }
}
