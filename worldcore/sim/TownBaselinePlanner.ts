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

import {
  getStationProtoIdsForTier,
  tryInferTownTierFromSpawn,
} from "../world/TownTierRules";

// NOTE: We intentionally use a *structural* bounds type here (cell-coordinate bounds).
// Some parts of the codebase may brand/nominally-type bounds in SimGrid.
// TownBaselinePlanner only needs these four fields, so keeping this structural
// avoids type friction when called from other packages (e.g., web-backend).
export type CellBounds = { minCx: number; maxCx: number; minCz: number; maxCz: number };

// NOTE: simBrain passes through optional DB metadata (archetype/proto/variant/tier).
// Keep these optional so older callers (or tests) can provide just the core fields.
export type TownLikeSpawnRow = {
  shardId: string;
  spawnId: string;
  type: string;

  archetype?: string;
  protoId?: string;
  variantId?: string | null;

  x: number;
  y: number;
  z: number;
  regionId: string | null;

  // Option B: DB-backed tier (spawn_points.town_tier). Only meaningful for type='town'.
  townTier?: number | null;
};

export type TownBaselineSpawnIdMode = "legacy" | "seed";

export type TownBaselinePlanOptions = {
  bounds: CellBounds;
  cellSize: number;
  townTypes: string[];

  // Mailbox baseline (POI placeholder)
  seedMailbox: boolean;
  mailboxType?: string; // default: "mailbox"
  mailboxProtoId?: string; // default: "mailbox_basic"
  mailboxRadius?: number; // default: 8

  // Rest baseline (POI placeholder)
  seedRest: boolean;
  restType?: string; // default: "rest"
  restProtoId?: string; // default: "rest_spot_basic"
  restRadius?: number; // default: 10

  // Crafting stations baseline (POI placeholders)
  seedStations: boolean;
  stationType?: string; // default: "station"
  stationProtoIds: string[]; // e.g. ["station_forge","station_alchemy","station_oven","station_mill"]
  stationRadius?: number; // default: 9

  // Optional: force a tier for station gating (dev/testing)
  townTierOverride?: number | null;

  // Optional: when tier is known, intersect stationProtoIds with tier-allowed stations
  respectTownTierStations?: boolean;

  // Vendor baseline (real NPC spawns)
  // NOTE: Vendors act as service anchors for serviceGates (vendor/buy/sell).
  // By default we seed one vendor per town/outpost so towns always have a shop.
  seedVendors?: boolean; // default: true
  vendorCount?: number; // default: 1
  vendorProtoId?: string; // default: "starter_alchemist"
  vendorRadius?: number; // default: 11

  // Guard baseline (real NPC spawns)
  guardCount: number; // default: 2
  guardProtoId?: string; // default: "town_guard"
  guardRadius?: number; // default: 12

  // Training dummy baseline (DPS testing)
  dummyCount: number; // default: 1
  dummyProtoId?: string; // default: "training_dummy_big"
  dummyRadius?: number; // default: 10

  // Spawn id strategy:
  // - "legacy": historic svc_* ids (kept for simBrain/backwards compatibility)
  // - "seed": seed:* ids suitable for web placement editor ownership
  spawnIdMode?: TownBaselineSpawnIdMode;

  // Only used when spawnIdMode="seed".
  // Example: "seed:town_baseline" => seed:town_baseline:<townKey>:<kindKey>
  seedBase?: string;
};

export type TownBaselinePlanResult = {
  townsConsidered: number;
  actions: PlaceSpawnAction[];
};

function norm(s: unknown): string {
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

function polarOffset(seed: string, radius?: number): { dx: number; dz: number } {
  const r = Math.max(0, Number(radius ?? 0));
  const a = hash01(seed) * Math.PI * 2;
  return {
    dx: Math.cos(a) * r,
    dz: Math.sin(a) * r,
  };
}

function computeRegionId(
  shardId: string,
  x: number,
  z: number,
  cellSize: number,
): string {
  const cs = Math.max(1, Math.floor(cellSize || 64));
  const cx = Math.floor(x / cs);
  const cz = Math.floor(z / cs);
  return `${shardId}:${cx},${cz}`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function inWorldBounds(x: number, z: number, bounds: CellBounds, cellSize: number): boolean {
  const cs = Math.max(1, Math.floor(cellSize || 64));
  const minX = bounds.minCx * cs;
  const maxX = (bounds.maxCx + 1) * cs;
  const minZ = bounds.minCz * cs;
  const maxZ = (bounds.maxCz + 1) * cs;
  return x >= minX && x < maxX && z >= minZ && z < maxZ;
}

function sanitizeId(s: string): string {
  return (
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "x"
  );
}

function sanitizeSeedToken(s: string, maxLen: number): string {
  const cleaned = String(s ?? "")
    .trim()
    .toLowerCase()
    // no colon inside tokens; colon separates namespaces
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const clipped = cleaned.slice(0, Math.max(1, Math.floor(maxLen || 32)));
  return clipped || "x";
}

function resolveSpawnIdMode(opts: TownBaselinePlanOptions): TownBaselineSpawnIdMode {
  return opts.spawnIdMode === "seed" ? "seed" : "legacy";
}

function resolveSeedBase(opts: TownBaselinePlanOptions): string {
  const raw = String(opts.seedBase ?? "seed:town_baseline").trim();
  if (!raw) return "seed:town_baseline";

  // Never allow brain:* as a seed base (that would make tools treat these as read-only).
  if (raw.toLowerCase().startsWith("brain:")) return "seed:town_baseline";

  // If user forgot the namespace, help them.
  if (!raw.includes(":")) return `seed:${sanitizeSeedToken(raw, 24)}`;

  return raw;
}

function makeSpawnIdLegacy(prefix: string, townSpawnId: string): string {
  // Stable + readable + low collision risk (legacy format)
  return `${prefix}_${townSpawnId}`;
}

function makeSpawnIdSeed(opts: TownBaselinePlanOptions, townSpawnId: string, kind: string): string {
  const base = resolveSeedBase(opts);
  const townKey = sanitizeSeedToken(townSpawnId, 48);
  const kindKey = sanitizeSeedToken(kind, 64);
  return `${base}:${townKey}:${kindKey}`;
}

function makeSpawnId(
  opts: TownBaselinePlanOptions,
  legacyPrefix: string,
  townSpawnId: string,
  seedKind: string,
): string {
  const mode = resolveSpawnIdMode(opts);
  if (mode === "seed") return makeSpawnIdSeed(opts, townSpawnId, seedKind);
  return makeSpawnIdLegacy(legacyPrefix, townSpawnId);
}

function intersectInOrder(base: string[], allowed: Set<string>): string[] {
  const out: string[] = [];
  for (const v of base) {
    if (allowed.has(v)) out.push(v);
  }
  return out;
}

function resolveTownTier(town: TownLikeSpawnRow, opts: TownBaselinePlanOptions): number | null {
  // Highest priority: explicit override (dev/testing/tooling)
  if (opts.townTierOverride !== null && opts.townTierOverride !== undefined) {
    const n = Number(opts.townTierOverride);
    return Number.isFinite(n) ? n : null;
  }

  // Prefer DB-backed tier; otherwise fall back to tier tokens in spawn metadata.
  const inferred = tryInferTownTierFromSpawn({
    townTier: town.townTier ?? null,
    variantId: town.variantId ?? null,
    spawnId: town.spawnId,
    archetype: town.archetype ?? "",
    tags: null,
  });

  return inferred ?? null;
}

function resolveStationProtoIdsForTown(town: TownLikeSpawnRow, opts: TownBaselinePlanOptions): string[] {
  const base = (opts.stationProtoIds ?? []).map(norm).filter(Boolean);
  if (base.length === 0) return [];

  if (!opts.respectTownTierStations) return base;

  // Conservative default: unknown tier => treat as tier 1 (prevents “capital services in a shack”).
  const tier = resolveTownTier(town, opts) ?? 1;
  const allowed = new Set(getStationProtoIdsForTier(tier));
  return intersectInOrder(base, allowed);
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

    const shardId = String(t.shardId);
    const townSpawnId = String(t.spawnId);
    const baseX = Number(t.x ?? 0);
    const baseY = Number(t.y ?? 0);
    const baseZ = Number(t.z ?? 0);

    const regionId = t.regionId || computeRegionId(shardId, baseX, baseZ, opts.cellSize);

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
            spawnId: makeSpawnId(opts, "svc_mail", townSpawnId, "mailbox"),
            type: norm(opts.mailboxType || "mailbox"),
            archetype: "mailbox",
            protoId: norm(opts.mailboxProtoId || "mailbox_basic"),
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
            spawnId: makeSpawnId(opts, "svc_rest", townSpawnId, "rest"),
            type: norm(opts.restType || "rest"),
            archetype: "rest",
            protoId: norm(opts.restProtoId || "rest_spot_basic"),
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
      const stationType = norm(opts.stationType || "station") || "station";
      const stationRadius = Math.max(0, Number(opts.stationRadius ?? 9) || 9);

      const protoIds = resolveStationProtoIdsForTown(t, opts);

      for (const pid of protoIds) {
        const off = polarOffset(`${townSpawnId}:station:${pid}`, stationRadius);
        const x = round2(baseX + off.dx);
        const z = round2(baseZ + off.dz);

        if (!inWorldBounds(x, z, opts.bounds, opts.cellSize)) continue;

        const legacyPrefix = `stn_${sanitizeId(pid)}`;
        const seedKind = `station_${sanitizeId(pid)}`;

        actions.push({
          kind: "place_spawn",
          spawn: {
            shardId,
            spawnId: makeSpawnId(opts, legacyPrefix, townSpawnId, seedKind),
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

    // Vendors (service anchors)
    const seedVendors = opts.seedVendors !== false;
    const vendorCount = Math.max(0, Math.floor(opts.vendorCount ?? 1));
    if (seedVendors && vendorCount > 0) {
      const vendorRadius = Math.max(0, Number(opts.vendorRadius ?? 11) || 11);
      const vendorProto = norm(opts.vendorProtoId || "starter_alchemist") || "starter_alchemist";

      for (let i = 0; i < vendorCount; i++) {
        const off = polarOffset(`${townSpawnId}:vendor:${i}`, vendorRadius);
        const x = round2(baseX + off.dx);
        const z = round2(baseZ + off.dz);

        if (!inWorldBounds(x, z, opts.bounds, opts.cellSize)) continue;

        const legacyPrefix = `svc_vendor${i + 1}`;
        const seedKind = `vendor_${i + 1}`;

        actions.push({
          kind: "place_spawn",
          spawn: {
            shardId,
            spawnId: makeSpawnId(opts, legacyPrefix, townSpawnId, seedKind),
            type: "npc",
            archetype: vendorProto,
            protoId: vendorProto,
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
      const guardRadius = Math.max(0, Number(opts.guardRadius ?? 12) || 12);
      const guardProto = norm(opts.guardProtoId || "town_guard") || "town_guard";

      for (let i = 0; i < guardCount; i++) {
        const off = polarOffset(`${townSpawnId}:guard:${i}`, guardRadius);
        const x = round2(baseX + off.dx);
        const z = round2(baseZ + off.dz);

        if (!inWorldBounds(x, z, opts.bounds, opts.cellSize)) continue;

        const legacyPrefix = `svc_guard${i + 1}`;
        const seedKind = `guard_${i + 1}`;

        actions.push({
          kind: "place_spawn",
          spawn: {
            shardId,
            spawnId: makeSpawnId(opts, legacyPrefix, townSpawnId, seedKind),
            type: "npc",
            archetype: guardProto,
            protoId: guardProto,
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
      const dummyRadius = Math.max(0, Number(opts.dummyRadius ?? 10) || 10);
      const dummyProto = norm(opts.dummyProtoId || "training_dummy_big") || "training_dummy_big";

      for (let i = 0; i < dummyCount; i++) {
        const off = polarOffset(`${townSpawnId}:dummy:${i}`, dummyRadius);
        const x = round2(baseX + off.dx);
        const z = round2(baseZ + off.dz);

        if (!inWorldBounds(x, z, opts.bounds, opts.cellSize)) continue;

        const legacyPrefix = `svc_dummy${i + 1}`;
        const seedKind = `dummy_${i + 1}`;

        actions.push({
          kind: "place_spawn",
          spawn: {
            shardId,
            spawnId: makeSpawnId(opts, legacyPrefix, townSpawnId, seedKind),
            type: "npc",
            archetype: dummyProto,
            protoId: dummyProto,
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
