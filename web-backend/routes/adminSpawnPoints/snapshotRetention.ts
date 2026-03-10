//web-backend/routes/adminSpawnPoints/snapshotRetention.ts

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ensureSnapshotDir,
  isExpired,
  listStoredSnapshots,
  type StoredSpawnSnapshotMeta,
} from "./snapshotStore";

export type SpawnSnapshotsRetentionJobOptions = {
  includeArchived: boolean;
  includePinned: boolean;
  olderThanDays: number;
  dryRun: boolean;
};

export type SpawnSnapshotsRetentionJobResult = {
  ok: boolean;
  dryRun: boolean;
  includeArchived: boolean;
  includePinned: boolean;
  olderThanDays: number;
  skippedPinned: number;
  count: number;
  bytes: number;
  ids: string[];
  deleted?: number;
  failed?: number;
};

export type SpawnSnapshotsRetentionStatusResponse = {
  kind: "spawn_points.snapshots.retention_status";
  ok: boolean;
  error?: string;
  enabled: boolean;
  intervalMinutes: number;
  dryRun: boolean;
  includeArchived: boolean;
  includePinned: boolean;
  olderThanDays: number;
  runOnBoot: boolean;
  lastRunAt?: string;
  lastResult?: SpawnSnapshotsRetentionJobResult;
};

let spawnSnapshotsRetentionLastRunAt: string | null = null;
let spawnSnapshotsRetentionLastResult: SpawnSnapshotsRetentionJobResult | null = null;
let spawnSnapshotsRetentionConfig: {
  enabled: boolean;
  intervalMinutes: number;
  dryRun: boolean;
  includeArchived: boolean;
  includePinned: boolean;
  olderThanDays: number;
  runOnBoot: boolean;
} | null = null;
let spawnSnapshotsRetentionTimer: NodeJS.Timeout | null = null;

export function getSpawnSnapshotsRetentionStatus(): SpawnSnapshotsRetentionStatusResponse {
  const cfg =
    spawnSnapshotsRetentionConfig ??
    ({
      enabled: false,
      intervalMinutes: 0,
      dryRun: true,
      includeArchived: false,
      includePinned: false,
      olderThanDays: 0,
      runOnBoot: false,
    } as const);

  return {
    kind: "spawn_points.snapshots.retention_status",
    ok: true,
    enabled: cfg.enabled,
    intervalMinutes: cfg.intervalMinutes,
    dryRun: cfg.dryRun,
    includeArchived: cfg.includeArchived,
    includePinned: cfg.includePinned,
    olderThanDays: cfg.olderThanDays,
    runOnBoot: cfg.runOnBoot,
    ...(spawnSnapshotsRetentionLastRunAt ? { lastRunAt: spawnSnapshotsRetentionLastRunAt } : null),
    ...(spawnSnapshotsRetentionLastResult ? { lastResult: spawnSnapshotsRetentionLastResult } : null),
  };
}

export async function runSpawnSnapshotsRetentionJob(
  opts: SpawnSnapshotsRetentionJobOptions,
): Promise<SpawnSnapshotsRetentionJobResult> {
  const includeArchived = Boolean(opts.includeArchived);
  const includePinned = Boolean(opts.includePinned);
  const olderThanDays = Math.max(0, Math.min(3650, Math.floor(Number(opts.olderThanDays) || 0)));
  const dryRun = Boolean(opts.dryRun);

  const nowMs = Date.now();
  const metas = await listStoredSnapshots();
  const candidates: StoredSpawnSnapshotMeta[] = [];
  let skippedPinned = 0;

  for (const m of metas) {
    if (!includePinned && Boolean((m as any).isPinned)) {
      skippedPinned += 1;
      continue;
    }

    const expired = isExpired((m as any).expiresAt, nowMs);
    if (expired) {
      candidates.push(m);
      continue;
    }

    if (includeArchived && Boolean((m as any).isArchived)) {
      const savedAtMs = new Date(String((m as any).savedAt ?? "")).getTime();
      const ageDays = Number.isFinite(savedAtMs) ? Math.floor((nowMs - savedAtMs) / (24 * 60 * 60 * 1000)) : 999999;
      if (ageDays >= olderThanDays) candidates.push(m);
    }
  }

  const ids = candidates.map((c) => c.id).sort((a, b) => a.localeCompare(b));
  const totalBytes = candidates.reduce((acc, c) => acc + Number((c as any).bytes ?? 0), 0);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      includeArchived,
      includePinned,
      olderThanDays,
      skippedPinned,
      count: ids.length,
      bytes: totalBytes,
      ids,
    };
  }

  const dir = await ensureSnapshotDir();
  let deleted = 0;
  let failed = 0;

  for (const id of ids) {
    const file = path.join(dir, `${id}.json`);
    try {
      await fs.unlink(file);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    ok: true,
    dryRun: false,
    includeArchived,
    includePinned,
    olderThanDays,
    skippedPinned,
    count: ids.length,
    bytes: totalBytes,
    ids,
    deleted,
    failed,
  };
}

export function startSpawnSnapshotsRetentionScheduler(): void {
  const enabled = String(process.env.PW_SPAWN_SNAPSHOT_RETENTION_ENABLED ?? "").trim();
  const isEnabled = enabled === "1" || enabled.toLowerCase() === "true" || enabled.toLowerCase() === "yes";
  if (!isEnabled) {
    spawnSnapshotsRetentionConfig = {
      enabled: false,
      intervalMinutes: 0,
      dryRun: true,
      includeArchived: false,
      includePinned: false,
      olderThanDays: 0,
      runOnBoot: false,
    };
    return;
  }

  const intervalMinRaw = Number(process.env.PW_SPAWN_SNAPSHOT_RETENTION_INTERVAL_MINUTES ?? 60);
  const intervalMin = Number.isFinite(intervalMinRaw)
    ? Math.max(1, Math.min(7 * 24 * 60, Math.floor(intervalMinRaw)))
    : 60;

  const dryRunEnv = String(process.env.PW_SPAWN_SNAPSHOT_RETENTION_DRY_RUN ?? "1").trim().toLowerCase();
  const dryRun = !(dryRunEnv === "0" || dryRunEnv === "false" || dryRunEnv === "no");

  const includeArchivedEnv = String(process.env.PW_SPAWN_SNAPSHOT_RETENTION_INCLUDE_ARCHIVED ?? "").trim().toLowerCase();
  const includeArchived = includeArchivedEnv === "1" || includeArchivedEnv === "true" || includeArchivedEnv === "yes";

  const includePinnedEnv = String(process.env.PW_SPAWN_SNAPSHOT_RETENTION_INCLUDE_PINNED ?? "").trim().toLowerCase();
  const includePinned = includePinnedEnv === "1" || includePinnedEnv === "true" || includePinnedEnv === "yes";

  const olderThanDaysRaw = Number(process.env.PW_SPAWN_SNAPSHOT_RETENTION_ARCHIVED_OLDER_THAN_DAYS ?? 30);
  const olderThanDays = Number.isFinite(olderThanDaysRaw)
    ? Math.max(0, Math.min(3650, Math.floor(olderThanDaysRaw)))
    : 30;

  const runOnBootEnv = String(process.env.PW_SPAWN_SNAPSHOT_RETENTION_RUN_ON_BOOT ?? "").trim().toLowerCase();
  const runOnBoot = runOnBootEnv === "1" || runOnBootEnv === "true" || runOnBootEnv === "yes";

  spawnSnapshotsRetentionConfig = {
    enabled: true,
    intervalMinutes: intervalMin,
    dryRun,
    includeArchived,
    includePinned,
    olderThanDays,
    runOnBoot,
  };

  const opts: SpawnSnapshotsRetentionJobOptions = {
    includeArchived,
    includePinned,
    olderThanDays,
    dryRun,
  };

  const logPrefix = "[web-backend][snapshots][retention]";

  const tick = async () => {
    try {
      const r = await runSpawnSnapshotsRetentionJob(opts);
      spawnSnapshotsRetentionLastRunAt = new Date().toISOString();
      spawnSnapshotsRetentionLastResult = r;

      const mode = r.dryRun ? "DRY_RUN" : "DELETE";
      console.log(
        `${logPrefix} ${mode} candidates=${r.count} bytes=${r.bytes} skippedPinned=${r.skippedPinned} includeArchived=${r.includeArchived ? "1" : "0"} includePinned=${r.includePinned ? "1" : "0"} olderThanDays=${r.olderThanDays}`,
      );
      if (!r.dryRun && (r.deleted || r.failed)) {
        console.log(`${logPrefix} deleted=${r.deleted ?? 0} failed=${r.failed ?? 0}`);
      }
    } catch (e: any) {
      console.error(`${logPrefix} error`, e?.message || e);
    }
  };

  if (runOnBoot) void tick();

  if (spawnSnapshotsRetentionTimer) clearInterval(spawnSnapshotsRetentionTimer);
  spawnSnapshotsRetentionTimer = setInterval(() => void tick(), intervalMin * 60 * 1000);

  console.log(`${logPrefix} enabled intervalMin=${intervalMin} dryRun=${dryRun ? "1" : "0"}`);
}
