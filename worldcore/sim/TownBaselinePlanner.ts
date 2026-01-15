// worldcore/sim/TownBaselinePlanner.ts

// -----------------------------------------------------------------------------
// Purpose:
//   Deterministically seed "baseline" spawn_points around town-like POIs.
//
// Why:
//   - Towns/outposts should have minimal services without hand-placing NPCs.
//   - We seed DB-backed spawn_points so hydration + tools can reason about them.
//
// Output:
//   - PlaceSpawnAction[] suitable for simBrain applyToDb()
// -----------------------------------------------------------------------------

import type { PlaceSpawnAction } from "./BrainActions";
import type { Bounds } from "./SimGrid";

export type TownLikeSpawnRow = {
  shardId: string;
  spawnId: string;
  type: string;
  x: number;
  y: number;
  z: number;
  regionId: string | null;
};

export type TownBaselinePlanOptions = {
  bounds: Bounds;
  cellSize: number;
  townTypes: string[];

  // Mailbox baseline (POI placeholder)
  seedMailbox: boolean;
  mailboxType: string;     // default: "mailbox"
  mailboxProtoId: string;  // default: "mailbox_basic"
  mailboxRadius: number;   // default: 8

  // Rest baseline (POI placeholder)
  seedRest: boolean;
  restType: string;        // default: "rest"
  restProtoId: string;     // default: "rest_spot_basic"
  restRadius: number;      // default: 10

  // Crafting stations baseline (POI placeholders)
  seedStations: boolean;
  stationType: string;        // default: "station"
  stationProtoIds: string[];  // e.g. ["station_forge","station_alchemy","station_oven","station_mill"]
  stationRadius: number;      // default: 9

 // Optional: force a tier for station gating (dev/testing)
  townTierOverride?: number | null;

  // Optional: when tier is known, intersect stationProtoIds with tier-allowed stations
  respectTownTierStations?: boolean;

  // Guard baseline (real NPC spawns)
  guardCount: number;      // default: 2
  guardProtoId: string;    // default: "town_guard"
  guardRadius: number;     // default: 12

  // Training dummy baseline (DPS testing)
  dummyCount: number;      // default: 1
  dummyProtoId: string;    // default: "training_dummy_big"
  dummyRadius: number;     // default: 10
};

export type TownBaselinePlanResult = {
  townsConsidered: number;
  actions: PlaceSpawnAction[];
};

function norm(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

// FNV-1a 32-bit hash (deterministic across runtimes)
function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hash01(seed: string): number {
  // [0, 1)
  return hash32(seed) / 0x100000000;
}

function polarOffset(seed: string, radius: number): { dx: number; dz: number } {
  const a = hash01(seed) * Math.PI * 2;
  return {
    dx: Math.cos(a) * radius,
    dz: Math.sin(a) * radius,
  };
}

function computeRegionId(
  shardId: string,
  x: number,
  z: number,
  cellSize: number,
): string {
  const cx = Math.floor(x / cellSize);
  const cz = Math.floor(z / cellSize);
  return `${shardId}:${cx},${cz}`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function inWorldBounds(
  x: number,
  z: number,
  bounds: Bounds,
  cellSize: number,
): boolean {
  const minX = bounds.minCx * cellSize;
  const maxX = (bounds.maxCx + 1) * cellSize;
  const minZ = bounds.minCz * cellSize;
  const maxZ = (bounds.maxCz + 1) * cellSize;
  return x >= minX && x < maxX && z >= minZ && z < maxZ;
}

function sanitizeId(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "x";
}

function makeSpawnId(prefix: string, townSpawnId: string): string {
  // Stable + readable + low collision risk
  return `${prefix}_${townSpawnId}`;
}

export function planTownBaselines(
  townSpawns: TownLikeSpawnRow[],
  opts: TownBaselinePlanOptions,
): TownBaselinePlanResult {
  const townTypes = new Set((opts.townTypes ?? []).map(norm).filter(Boolean));
  const actions: PlaceSpawnAction[] = [];

  for (const t of townSpawns) {
    const type = norm(t.type);
    if (!type || (townTypes.size > 0 && !townTypes.has(type))) continue;

    const shardId = t.shardId;
    const townSpawnId = String(t.spawnId);
    const baseX = Number(t.x ?? 0);
    const baseY = Number(t.y ?? 0);
    const baseZ = Number(t.z ?? 0);
    const regionId =
      t.regionId || computeRegionId(shardId, baseX, baseZ, opts.cellSize);

    // Mailbox
    if (opts.seedMailbox) {
      const off = polarOffset(`${townSpawnId}:mailbox`, opts.mailboxRadius);
      const x = round2(baseX + off.dx);
      const z = round2(baseZ + off.dz);

      if (inWorldBounds(x, z, opts.bounds, opts.cellSize)) {
        actions.push({
          kind: "place_spawn",
          spawn: {
            shardId,
            spawnId: makeSpawnId("svc_mail", townSpawnId),
            type: norm(opts.mailboxType || "mailbox"),
            archetype: "mailbox",
            protoId: opts.mailboxProtoId || "mailbox_basic",
            variantId: null,
            x,
            y: baseY,
            z,
            regionId,
          },
        });
      }
    }

    // Rest
    if (opts.seedRest) {
      const off = polarOffset(`${townSpawnId}:rest`, opts.restRadius);
      const x = round2(baseX + off.dx);
      const z = round2(baseZ + off.dz);

      if (inWorldBounds(x, z, opts.bounds, opts.cellSize)) {
        actions.push({
          kind: "place_spawn",
          spawn: {
            shardId,
            spawnId: makeSpawnId("svc_rest", townSpawnId),
            type: norm(opts.restType || "rest"),
            archetype: "rest",
            protoId: opts.restProtoId || "rest_spot_basic",
            variantId: null,
            x,
            y: baseY,
            z,
            regionId,
          },
        });
      }
    }

// Crafting stations (POI placeholders)
if (opts.seedStations) {
  const protoIds = (opts.stationProtoIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
  const stationType = norm(opts.stationType || "station") || "station";
  const stationRadius = Math.max(0, Number(opts.stationRadius ?? 9) || 9);

  for (const pid of protoIds) {
    const off = polarOffset(`${townSpawnId}:station:${pid}`, stationRadius);
    const x = round2(baseX + off.dx);
    const z = round2(baseZ + off.dz);

    if (!inWorldBounds(x, z, opts.bounds, opts.cellSize)) continue;

    actions.push({
      kind: "place_spawn",
      spawn: {
        shardId,
        spawnId: makeSpawnId(`stn_${sanitizeId(pid)}`, townSpawnId),
        type: stationType,
        archetype: "station",
        protoId: pid,
        variantId: null,
        x,
        y: baseY,
        z,
        regionId,
      },
    });
  }
}

    // Guards
    const guardCount = Math.max(0, Math.floor(opts.guardCount ?? 0));
    if (guardCount > 0) {
      for (let i = 0; i < guardCount; i++) {
        const off = polarOffset(`${townSpawnId}:guard:${i}`, opts.guardRadius);
        const x = round2(baseX + off.dx);
        const z = round2(baseZ + off.dz);

        if (!inWorldBounds(x, z, opts.bounds, opts.cellSize)) continue;

        const protoId = opts.guardProtoId || "town_guard";
        actions.push({
          kind: "place_spawn",
          spawn: {
            shardId,
            spawnId: makeSpawnId(`svc_guard${i + 1}`, townSpawnId),
            type: "npc",
            archetype: protoId,
            protoId,
            variantId: null,
            x,
            y: baseY,
            z,
            regionId,
          },
        });
      }
    }

    // Training dummies (neutral high-HP targets)
    const dummyCount = Math.max(0, Math.floor(opts.dummyCount ?? 0));
    if (dummyCount > 0) {
      for (let i = 0; i < dummyCount; i++) {
        const off = polarOffset(`${townSpawnId}:dummy:${i}`, opts.dummyRadius);
        const x = round2(baseX + off.dx);
        const z = round2(baseZ + off.dz);

        if (!inWorldBounds(x, z, opts.bounds, opts.cellSize)) continue;

        const protoId = opts.dummyProtoId || "training_dummy_big";
        actions.push({
          kind: "place_spawn",
          spawn: {
            shardId,
            spawnId: makeSpawnId(`svc_dummy${i + 1}`, townSpawnId),
            type: "npc",
            archetype: protoId,
            protoId,
            variantId: null,
            x,
            y: baseY,
            z,
            regionId,
          },
        });
      }
    }
  }

  return {
    townsConsidered: townSpawns.length,
    actions,
  };
}
