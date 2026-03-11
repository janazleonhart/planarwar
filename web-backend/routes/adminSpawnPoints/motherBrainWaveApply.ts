//web-backend/routes/adminSpawnPoints/motherBrainWaveApply.ts

export function buildEffectiveExistingSpawnIds(args: {
  existingSpawnIds: Set<string>;
  existingBrainSpawnIds: string[];
  append: boolean;
}): Set<string> {
  const out = new Set<string>(args.existingSpawnIds);
  if (!args.append) {
    for (const sid of args.existingBrainSpawnIds ?? []) {
      out.delete(String(sid ?? ""));
    }
  }
  return out;
}

export async function applyMotherBrainWaveMutations(args: {
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> };
  shardId: string;
  filteredActions: any[];
  effectiveExistingSpawnIds: Set<string>;
  existingBrainIds: number[];
  append: boolean;
  updateExisting: boolean;
}): Promise<{ deleted: number; inserted: number; updated: number; skipped: number }> {
  const {
    client,
    shardId,
    filteredActions,
    effectiveExistingSpawnIds,
    existingBrainIds,
    append,
    updateExisting,
  } = args;

  let deleted = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  if (!append && existingBrainIds.length > 0) {
    await client.query(`DELETE FROM spawn_points WHERE id = ANY($1::int[])`, [existingBrainIds]);
    deleted = existingBrainIds.length;
  }

  for (const a of filteredActions ?? []) {
    if (!a || (a as any).kind !== "place_spawn") continue;
    const s = (a as any).spawn ?? null;
    const sid = String(s?.spawnId ?? "");
    if (!sid) continue;

    const exists = effectiveExistingSpawnIds.has(sid);
    if (exists) {
      if (!updateExisting) {
        skipped += 1;
        continue;
      }

      await client.query(
        `
          UPDATE spawn_points
          SET type = $3,
              archetype = $4,
              proto_id = $5,
              variant_id = $6,
              x = $7,
              y = $8,
              z = $9,
              region_id = $10
          WHERE shard_id = $1 AND spawn_id = $2
        `,
        [
          shardId,
          sid,
          String(s?.type ?? "npc"),
          String(s?.archetype ?? "npc"),
          s?.protoId != null ? String(s.protoId) : null,
          s?.variantId != null ? String(s.variantId) : null,
          Number(s?.x ?? 0),
          Number(s?.y ?? 0),
          Number(s?.z ?? 0),
          s?.regionId != null ? String(s.regionId) : null,
        ],
      );
      updated += 1;
      continue;
    }

    await client.query(
      `
        INSERT INTO spawn_points (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        shardId,
        sid,
        String(s?.type ?? "npc"),
        String(s?.archetype ?? "npc"),
        s?.protoId != null ? String(s.protoId) : null,
        s?.variantId != null ? String(s.variantId) : null,
        Number(s?.x ?? 0),
        Number(s?.y ?? 0),
        Number(s?.z ?? 0),
        s?.regionId != null ? String(s.regionId) : null,
      ],
    );
    inserted += 1;
  }

  return { deleted, inserted, updated, skipped };
}
