//web-backend/routes/adminSpawnPoints/cloneScatterOps.ts

import { db } from "../../../worldcore/db/Database";

export function finiteOr(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function sampleDisk(centerX: number, centerZ: number, radius: number): { x: number; z: number } {
  const r = Math.max(0, radius);
  if (r === 0) return { x: centerX, z: centerZ };
  const t = Math.random() * Math.PI * 2;
  const u = Math.random();
  const rr = Math.sqrt(u) * r;
  return { x: centerX + Math.cos(t) * rr, z: centerZ + Math.sin(t) * rr };
}

function randSuffix(len = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function normalizeSeedBase(v: any): string {
  const s = String(v ?? "").trim();
  if (!s) return "seed:editor";
  return s;
}

type SpawnOwnerKind = "brain" | "baseline" | "editor" | "system";

function ownerKindForSeedBase(seedBase: string): SpawnOwnerKind {
  const lower = String(seedBase || "").trim().toLowerCase();
  if (lower.startsWith("seed:")) return "editor";
  return "editor";
}

function makeSpawnId(seedBase: string, kind: "clone" | "scatter", hint: string): string {
  const safeHint = String(hint ?? "x")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9:_\-\.]/g, "");
  const base = normalizeSeedBase(seedBase);
  if (base.toLowerCase().startsWith("brain:")) {
    throw new Error("seedBase cannot be brain:* (brain spawns are read-only)");
  }
  const stamp = Date.now().toString(36);
  return `${base}:${kind}:${safeHint}:${stamp}:${randSuffix(6)}`;
}

async function loadNearbyPointsForSpacing(params: {
  shardId: string;
  regionId: string | null;
  centerX: number;
  centerZ: number;
  radius: number;
}): Promise<Array<{ x: number; z: number }>> {
  const { shardId, regionId, centerX, centerZ, radius } = params;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ) || radius <= 0) return [];

  const minX = centerX - radius;
  const maxX = centerX + radius;
  const minZ = centerZ - radius;
  const maxZ = centerZ + radius;

  const args: any[] = [shardId, minX, maxX, minZ, maxZ];
  let sql = `
    SELECT x, z
    FROM spawn_points
    WHERE shard_id = $1
      AND x IS NOT NULL AND z IS NOT NULL
      AND x BETWEEN $2 AND $3
      AND z BETWEEN $4 AND $5
  `;

  if (regionId) {
    sql += ` AND region_id = $6`;
    args.push(regionId);
  }

  const rows = await db.query(sql, args);
  return (rows.rows ?? [])
    .map((r: any) => ({ x: Number(r.x), z: Number(r.z) }))
    .filter((p: { x: number; z: number }) => Number.isFinite(p.x) && Number.isFinite(p.z));
}

function pickPositionWithSpacing(params: {
  centerX: number;
  centerZ: number;
  scatterRadius: number;
  minDistance: number;
  existing: Array<{ x: number; z: number }>;
  placed: Array<{ x: number; z: number }>;
}): { x: number; z: number } | null {
  const { centerX, centerZ, scatterRadius, minDistance, existing, placed } = params;
  const minD = Math.max(0, minDistance);
  const minD2 = minD * minD;
  if (minD === 0) return sampleDisk(centerX, centerZ, scatterRadius);

  for (let t = 0; t < 80; t++) {
    const p = sampleDisk(centerX, centerZ, scatterRadius);
    let ok = true;
    for (const q of existing) {
      if (dist2(p.x, p.z, q.x, q.z) < minD2) { ok = false; break; }
    }
    if (!ok) continue;
    for (const q of placed) {
      if (dist2(p.x, p.z, q.x, q.z) < minD2) { ok = false; break; }
    }
    if (ok) return p;
  }
  return null;
}

export type CloneScatterResult = {
  inserted: number;
  skippedBrainOwned: number;
  skippedMissingCoords: number;
  failedToPlace: number;
  createdIds: number[];
  createdSpawnIds: string[];
};

export async function cloneSpawnPoints(params: {
  shardId: string;
  ids: number[];
  countPerId: number;
  scatterRadius: number;
  minDistance: number;
  seedBase: string;
  regionOverride: string | null;
  actorId: unknown;
  mapRowToAdmin: (row: any) => any;
  isSpawnEditable: (spawnId: string) => boolean;
  strOrNull: (v: any) => string | null;
  numOrNull: (v: any) => number | null;
}): Promise<CloneScatterResult> {
  const { shardId, ids, countPerId, scatterRadius, minDistance, seedBase, regionOverride, actorId, mapRowToAdmin, isSpawnEditable, strOrNull, numOrNull } = params;
  const rows = await db.query(`
      SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier,
             owner_kind, owner_id, is_locked
      FROM spawn_points
      WHERE shard_id = $1 AND id = ANY($2::int[])
      `, [shardId, ids]);

  const source = (rows.rows ?? []).map(mapRowToAdmin);
  if (source.length === 0) throw new Error('not_found');

  let skippedBrainOwned = 0;
  let skippedMissingCoords = 0;
  let failedToPlace = 0;
  let inserted = 0;
  const createdIds: number[] = [];
  const createdSpawnIds: string[] = [];
  const actor = typeof actorId === 'string' && actorId.trim() ? actorId.trim() : null;

  for (const sp of source) {
    if (!isSpawnEditable(sp.spawnId) && sp.ownerKind !== 'editor') {
      skippedBrainOwned += 1;
      continue;
    }

    const baseX = numOrNull(sp.x);
    const baseZ = numOrNull(sp.z);
    const baseY = numOrNull(sp.y) ?? 0;
    if (baseX === null || baseZ === null) {
      skippedMissingCoords += 1;
      continue;
    }

    const targetRegionId = regionOverride ?? strOrNull(sp.regionId);
    const spacingRadius = Math.max(scatterRadius, minDistance);
    const existing = await loadNearbyPointsForSpacing({ shardId, regionId: targetRegionId, centerX: baseX, centerZ: baseZ, radius: spacingRadius });
    const placed: Array<{ x: number; z: number }> = [];

    for (let c = 0; c < countPerId; c++) {
      const p = pickPositionWithSpacing({ centerX: baseX, centerZ: baseZ, scatterRadius, minDistance, existing, placed });
      if (!p) { failedToPlace += 1; continue; }

      const spawnId = makeSpawnId(seedBase, 'clone', sp.spawnId);
      const ins = await db.query(`
          INSERT INTO spawn_points
            (
              shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier,
              owner_kind, owner_id, is_locked,
              source_kind, source_id, source_rev,
              updated_at
            )
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
          RETURNING id
          `, [
            shardId, spawnId, sp.type, sp.archetype, strOrNull(sp.protoId), strOrNull(sp.variantId), p.x, baseY, p.z, targetRegionId, numOrNull(sp.townTier), ownerKindForSeedBase(seedBase), actor, false, 'editor', 'paint_tools.clone', null,
          ]);
      const newId = Number(ins.rows?.[0]?.id ?? 0);
      if (Number.isFinite(newId) && newId > 0) createdIds.push(newId);
      createdSpawnIds.push(spawnId);
      inserted += 1;
      placed.push(p);
    }
  }

  return { inserted, skippedBrainOwned, skippedMissingCoords, failedToPlace, createdIds, createdSpawnIds };
}

export async function scatterSpawnPoints(params: {
  shardId: string;
  type: string;
  archetype: string;
  protoId: string | null;
  variantId: string | null;
  count: number;
  centerX: number;
  centerZ: number;
  y: number;
  regionId: string | null;
  townTier: number | null;
  scatterRadius: number;
  minDistance: number;
  seedBase: string;
  actorId: unknown;
}): Promise<Pick<CloneScatterResult, 'inserted' | 'failedToPlace' | 'createdIds' | 'createdSpawnIds'>> {
  const { shardId, type, archetype, protoId, variantId, count, centerX, centerZ, y, regionId, townTier, scatterRadius, minDistance, seedBase, actorId } = params;
  const spacingRadius = Math.max(scatterRadius, minDistance);
  const existing = await loadNearbyPointsForSpacing({ shardId, regionId, centerX, centerZ, radius: spacingRadius });
  const placed: Array<{ x: number; z: number }> = [];
  let inserted = 0;
  let failedToPlace = 0;
  const createdIds: number[] = [];
  const createdSpawnIds: string[] = [];
  const actor = typeof actorId === 'string' && actorId.trim() ? actorId.trim() : null;

  for (let i = 0; i < count; i++) {
    const p = pickPositionWithSpacing({ centerX, centerZ, scatterRadius, minDistance, existing, placed });
    if (!p) { failedToPlace += 1; continue; }

    const spawnId = makeSpawnId(seedBase, 'scatter', protoId || archetype || type);
    const ins = await db.query(`
        INSERT INTO spawn_points
          (
            shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier,
            owner_kind, owner_id, is_locked,
            source_kind, source_id, source_rev,
            updated_at
          )
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
        RETURNING id
        `, [
          shardId, spawnId, type, archetype, protoId, variantId, p.x, y, p.z, regionId, townTier, ownerKindForSeedBase(seedBase), actor, false, 'editor', 'paint_tools.scatter', null,
        ]);
    const newId = Number(ins.rows?.[0]?.id ?? 0);
    if (Number.isFinite(newId) && newId > 0) createdIds.push(newId);
    createdSpawnIds.push(spawnId);
    inserted += 1;
    placed.push(p);
  }

  return { inserted, failedToPlace, createdIds, createdSpawnIds };
}
