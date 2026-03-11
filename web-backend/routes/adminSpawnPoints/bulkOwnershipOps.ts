//web-backend/routes/adminSpawnPoints/bulkOwnershipOps.ts

type SpawnAuthority = "anchor" | "seed" | "brain" | "manual";

export type BulkOwnershipQueryAction = "adopt" | "release" | "lock" | "unlock";

export type BulkOwnershipQuery = {
  shardId?: string;
  regionId?: string | null;
  x?: number | null;
  z?: number | null;
  radius?: number | null;
  authority?: SpawnAuthority | null;
  type?: string | null;
  archetype?: string | null;
  protoId?: string | null;
  spawnId?: string | null;
};

export type BulkOwnershipQueryRequest = {
  shardId?: string;
  action: BulkOwnershipQueryAction;
  query?: BulkOwnershipQuery;
  ownerId?: string | null;
  commit?: boolean;
  confirm?: string | null;
};

export type BulkOwnershipOpsPreview = {
  limit: number;
  truncated: boolean;
  changeSpawnIds: string[];
  changeCount: number;
  readOnlySpawnIds: string[];
  readOnlyCount: number;
  noOpCount: number;
  sampleRows?: Array<{
    spawnId: string;
    ownerKind: string | null;
    ownerId: string | null;
    isLocked: boolean;
    wouldChange: boolean;
    reason: "change" | "readOnly" | "noOp";
  }>;
};

export type BulkOwnershipQueryResponseOk = {
  kind: "spawn_points.bulk_ownership";
  ok: true;
  action: BulkOwnershipQueryAction;
  shardId: string;
  matched: number;
  wouldChange: number;
  skippedReadOnly: number;
  skippedNoOp: number;
  expectedConfirmToken?: string;
  opsPreview?: BulkOwnershipOpsPreview;
  commit?: boolean;
  changed?: number;
};

export type BulkOwnershipQueryResponseErr = {
  kind: "spawn_points.bulk_ownership";
  ok: false;
  error: string;
  action?: BulkOwnershipQueryAction;
  shardId?: string;
  matched?: number;
  wouldChange?: number;
  skippedReadOnly?: number;
  skippedNoOp?: number;
  expectedConfirmToken?: string;
  opsPreview?: BulkOwnershipOpsPreview;
  commit?: boolean;
  changed?: number;
};

export type BulkOwnershipQueryResponse = BulkOwnershipQueryResponseOk | BulkOwnershipQueryResponseErr;

export function buildWhereFromQueryFilters(args: {
  shardId: string;
  query: BulkOwnershipQuery;
  numOrNull: (v: unknown) => number | null;
  strOrNull: (v: unknown) => string | null;
  normalizeAuthority: (v: unknown) => SpawnAuthority | null;
}): { whereSql: string; args: any[] } {
  const { shardId, query, numOrNull, strOrNull, normalizeAuthority } = args;
  const regionId = strOrNull(query.regionId);
  const x = numOrNull(query.x);
  const z = numOrNull(query.z);
  const radius = numOrNull(query.radius);

  const authority = normalizeAuthority(query.authority);
  const typeQ = strOrNull(query.type);
  const archetypeQ = strOrNull(query.archetype);
  const protoQ = strOrNull(query.protoId);
  const spawnQ = strOrNull(query.spawnId);

  const where: string[] = ["shard_id = $1"];
  const params: any[] = [shardId];
  let i = 2;

  if (regionId) {
    where.push(`region_id = $${i++}`);
    params.push(regionId);
  }

  if (!regionId && x !== null && z !== null && radius !== null) {
    const safeRadius = Math.max(0, Math.min(radius, 10_000));
    const r2 = safeRadius * safeRadius;
    where.push(`x IS NOT NULL AND z IS NOT NULL`);
    where.push(`((x - $${i}) * (x - $${i}) + (z - $${i + 1}) * (z - $${i + 1})) <= $${i + 2}`);
    params.push(x, z, r2);
    i += 3;
  }

  if (authority) {
    if (authority === "anchor") where.push(`spawn_id LIKE 'anchor:%'`);
    else if (authority === "seed") where.push(`spawn_id LIKE 'seed:%'`);
    else if (authority === "brain") where.push(`spawn_id LIKE 'brain:%'`);
    else where.push(`spawn_id NOT LIKE 'anchor:%' AND spawn_id NOT LIKE 'seed:%' AND spawn_id NOT LIKE 'brain:%'`);
  }

  if (typeQ) {
    where.push(`LOWER(type) = LOWER($${i++})`);
    params.push(typeQ);
  }
  if (archetypeQ) {
    where.push(`LOWER(archetype) = LOWER($${i++})`);
    params.push(archetypeQ);
  }
  if (protoQ) {
    where.push(`proto_id ILIKE $${i++}`);
    params.push(`%${protoQ}%`);
  }
  if (spawnQ) {
    where.push(`spawn_id ILIKE $${i++}`);
    params.push(`%${spawnQ}%`);
  }

  return { whereSql: where.join(" AND "), args: params };
}

export function planBulkOwnershipAction(args: {
  found: any[];
  action: BulkOwnershipQueryAction;
  ownerId: string | null;
  shardId: string;
  whereSql: string;
  whereArgs: any[];
  strOrNull: (v: unknown) => string | null;
  isSpawnEditable: (spawnId: string) => boolean;
  makeConfirmToken: (prefix: "WIPE" | "REPLACE", shardId: string, scope: unknown) => string;
}): {
  targetIds: number[];
  targetSpawnIds: string[];
  readOnlySpawnIds: string[];
  noOpCount: number;
  expectedConfirmToken: string | null;
  opsPreview: BulkOwnershipOpsPreview;
} {
  const { found, action, ownerId, shardId, whereSql, whereArgs, strOrNull, isSpawnEditable, makeConfirmToken } = args;
  const isRowEditable = (spawnId: string, ownerKind: string): boolean => {
    const okOwner = String(ownerKind ?? "").trim().toLowerCase() === "editor";
    return okOwner || isSpawnEditable(String(spawnId ?? ""));
  };

  const targetIds: number[] = [];
  const targetSpawnIds: string[] = [];
  const readOnlySpawnIds: string[] = [];
  let noOpCount = 0;

  for (const r of found as any[]) {
    const id = Number(r.id ?? 0);
    const spawnId = String(r.spawn_id ?? "");
    const ownerKind = String(r.owner_kind ?? "");
    const locked = Boolean(r.is_locked);
    if (!Number.isFinite(id) || id <= 0 || !spawnId) continue;

    if (action !== "adopt" && !isRowEditable(spawnId, ownerKind)) {
      readOnlySpawnIds.push(spawnId);
      continue;
    }

    if (action === "adopt") {
      const isAlready = String(ownerKind).trim().toLowerCase() === "editor" && (strOrNull(r.owner_id) ?? null) === ownerId;
      if (isAlready) {
        noOpCount++;
        continue;
      }
    }

    if (action === "release") {
      const isEditor = String(ownerKind).trim().toLowerCase() === "editor";
      if (!isEditor && !strOrNull(r.owner_id)) {
        noOpCount++;
        continue;
      }
    }

    if (action === "lock") {
      if (locked) {
        noOpCount++;
        continue;
      }
    }

    if (action === "unlock") {
      if (!locked) {
        noOpCount++;
        continue;
      }
    }

    targetIds.push(id);
    targetSpawnIds.push(spawnId);
  }

  const SAMPLE_LIMIT = 25;
  const sampleRows = found.slice(0, SAMPLE_LIMIT).map((r: any) => {
    const spawnId = String(r.spawn_id ?? "");
    const ownerKind = (strOrNull(r.owner_kind) ?? null) as string | null;
    const rowOwnerId = (strOrNull(r.owner_id) ?? null) as string | null;
    const locked = Boolean(r.is_locked);
    const editable = action === "adopt" ? true : isRowEditable(spawnId, ownerKind ?? "");
    if (!editable) {
      return { spawnId, ownerKind, ownerId: rowOwnerId, isLocked: locked, wouldChange: false, reason: "readOnly" as const };
    }

    let isNoOp = false;
    if (action === "adopt") {
      isNoOp = String(ownerKind ?? "").trim().toLowerCase() === "editor" && rowOwnerId === ownerId;
    } else if (action === "release") {
      const isEditor = String(ownerKind ?? "").trim().toLowerCase() === "editor";
      isNoOp = !isEditor && !rowOwnerId;
    } else if (action === "lock") {
      isNoOp = locked;
    } else if (action === "unlock") {
      isNoOp = !locked;
    }

    return {
      spawnId,
      ownerKind,
      ownerId: rowOwnerId,
      isLocked: locked,
      wouldChange: !isNoOp,
      reason: isNoOp ? ("noOp" as const) : ("change" as const),
    };
  });

  const PREVIEW_LIMIT = 75;
  const opsPreview: BulkOwnershipOpsPreview = {
    limit: PREVIEW_LIMIT,
    truncated: targetSpawnIds.length > PREVIEW_LIMIT || readOnlySpawnIds.length > PREVIEW_LIMIT,
    changeSpawnIds: targetSpawnIds.slice(0, PREVIEW_LIMIT),
    changeCount: targetSpawnIds.length,
    readOnlySpawnIds: readOnlySpawnIds.slice(0, PREVIEW_LIMIT),
    readOnlyCount: readOnlySpawnIds.length,
    noOpCount,
    sampleRows,
  };

  const expectedConfirmToken = targetIds.length > 0
    ? makeConfirmToken("REPLACE", shardId, { op: "bulk_ownership", action, whereSql, args: whereArgs, count: targetIds.length })
    : null;

  return { targetIds, targetSpawnIds, readOnlySpawnIds, noOpCount, expectedConfirmToken, opsPreview };
}

export async function applyBulkOwnershipAction(args: {
  db: { query: (sql: string, params?: any[]) => Promise<any> };
  shardId: string;
  action: BulkOwnershipQueryAction;
  targetIds: number[];
  ownerId: string | null;
}): Promise<number> {
  const { db, shardId, action, targetIds, ownerId } = args;
  if (targetIds.length === 0) return 0;

  let changed = 0;
  if (action === "adopt") {
    const upd = await db.query(
      `UPDATE spawn_points SET owner_kind='editor', owner_id=$3, updated_at=NOW() WHERE shard_id=$1 AND id = ANY($2::int[])`,
      [shardId, targetIds, ownerId],
    );
    changed = Number((upd as any).rowCount ?? targetIds.length);
  } else if (action === "release") {
    const upd = await db.query(
      `
      UPDATE spawn_points
      SET
        owner_kind = CASE
          WHEN spawn_id LIKE 'seed:%' THEN 'baseline'
          WHEN spawn_id LIKE 'brain:%' THEN 'brain'
          ELSE NULL
        END,
        owner_id = NULL,
        updated_at = NOW()
      WHERE shard_id=$1 AND id = ANY($2::int[])
      `,
      [shardId, targetIds],
    );
    changed = Number((upd as any).rowCount ?? targetIds.length);
  } else if (action === "lock") {
    const upd = await db.query(
      `UPDATE spawn_points SET is_locked=TRUE, updated_at=NOW() WHERE shard_id=$1 AND id = ANY($2::int[])`,
      [shardId, targetIds],
    );
    changed = Number((upd as any).rowCount ?? targetIds.length);
  } else if (action === "unlock") {
    const upd = await db.query(
      `UPDATE spawn_points SET is_locked=FALSE, updated_at=NOW() WHERE shard_id=$1 AND id = ANY($2::int[])`,
      [shardId, targetIds],
    );
    changed = Number((upd as any).rowCount ?? targetIds.length);
  }

  return changed;
}
