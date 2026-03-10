//web-backend/routes/adminSpawnPoints/townBaselineApply.ts

import { db } from "../../../worldcore/db/Database";

type TownBaselineApplySpawn = {
  spawnId?: string | null;
  type: string;
  archetype: string;
  protoId?: string | null;
  variantId?: string | null;
  x?: number | null;
  y?: number | null;
  z?: number | null;
  regionId?: string | null;
  townTier?: number | null;
};

type TownBaselineApplyPlanItem = {
  spawn: TownBaselineApplySpawn;
};

type TownBaselineApplyPlan = {
  shardId: string;
  planItems: TownBaselineApplyPlanItem[];
};

export type TownBaselineApplyCounts = {
  inserted: number;
  updated: number;
  skipped: number;
  skippedReadOnly: number;
  skippedProtected: number;
};

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function approxEq(a: number | null, b: number | null, eps = 1e-6): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) <= eps;
}

function sameSpawnRow(existing: any, planned: TownBaselineApplySpawn): boolean {
  const exType = String(existing.type ?? "");
  const exArch = String(existing.archetype ?? "");
  const exProto = strOrNull(existing.proto_id);
  const exVar = strOrNull(existing.variant_id);
  const exRegion = strOrNull(existing.region_id);
  const exTier = numOrNull(existing.town_tier);
  const exX = numOrNull(existing.x);
  const exY = numOrNull(existing.y);
  const exZ = numOrNull(existing.z);

  return (
    exType === planned.type &&
    exArch === planned.archetype &&
    exProto === strOrNull(planned.protoId) &&
    exVar === strOrNull(planned.variantId) &&
    exRegion === strOrNull(planned.regionId) &&
    (exTier ?? null) === (numOrNull(planned.townTier) ?? null) &&
    approxEq(exX, numOrNull(planned.x)) &&
    approxEq(exY, numOrNull(planned.y)) &&
    approxEq(exZ, numOrNull(planned.z))
  );
}

export async function applyTownBaselinePlan(args: {
  plan: TownBaselineApplyPlan;
  isSpawnEditable: (spawnId: string) => boolean;
}): Promise<TownBaselineApplyCounts> {
  const { plan, isSpawnEditable } = args;
  const counts: TownBaselineApplyCounts = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    skippedReadOnly: 0,
    skippedProtected: 0,
  };

  await db.query("BEGIN");
  try {
    for (const item of plan.planItems) {
      const sp = item.spawn;
      const sid = String(sp.spawnId ?? "");

      if (!isSpawnEditable(sid)) {
        counts.skippedReadOnly += 1;
        continue;
      }

      const lockRes = await db.query(
        `
        SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier, owner_kind, owner_id, is_locked
        FROM spawn_points
        WHERE shard_id = $1 AND spawn_id = $2
        LIMIT 1
        FOR UPDATE
        `,
        [plan.shardId, sid],
      );

      const ex = lockRes.rows?.[0];
      if (!ex) {
        await db.query(
          `
          INSERT INTO spawn_points
            (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier, owner_kind, source_kind, source_id)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          `,
          [
            plan.shardId,
            sid,
            sp.type,
            sp.archetype,
            strOrNull(sp.protoId),
            strOrNull(sp.variantId),
            numOrNull(sp.x),
            numOrNull(sp.y) ?? 0,
            numOrNull(sp.z),
            strOrNull(sp.regionId),
            numOrNull(sp.townTier),
            "baseline",
            "town_baseline",
            "planner",
          ],
        );
        counts.inserted += 1;
        continue;
      }

      if (String(ex.owner_kind ?? "") === "editor" || Boolean(ex.is_locked)) {
        counts.skippedProtected += 1;
        continue;
      }

      if (sameSpawnRow(ex, sp)) {
        counts.skipped += 1;
        continue;
      }

      await db.query(
        `
        UPDATE spawn_points
        SET type = $3,
            archetype = $4,
            proto_id = $5,
            variant_id = $6,
            x = $7,
            y = $8,
            z = $9,
            region_id = $10,
            town_tier = $11
        WHERE shard_id = $1 AND id = $2
        `,
        [
          plan.shardId,
          Number(ex.id),
          sp.type,
          sp.archetype,
          strOrNull(sp.protoId),
          strOrNull(sp.variantId),
          numOrNull(sp.x),
          numOrNull(sp.y) ?? 0,
          numOrNull(sp.z),
          strOrNull(sp.regionId),
          numOrNull(sp.townTier),
        ],
      );
      counts.updated += 1;
    }

    await db.query("COMMIT");
    return counts;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
