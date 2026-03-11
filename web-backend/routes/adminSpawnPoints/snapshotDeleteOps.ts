//web-backend/routes/adminSpawnPoints/snapshotDeleteOps.ts

import { createHash } from "crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ensureSnapshotDir,
  isExpired,
  listStoredSnapshots,
  type StoredSpawnSnapshotDoc,
  type StoredSpawnSnapshotMeta,
} from "./snapshotStore";

export type SnapshotDeleteConfirmInfo = {
  dir: string;
  file: string;
  id: string;
  expectedConfirmToken: string;
};

export type SnapshotBulkDeletePlan = {
  includePinned: boolean;
  requested: number;
  found: number;
  missing: number;
  missingIds: string[];
  skippedPinned: number;
  activeCount: number;
  count: number;
  bytes: number;
  ids: string[];
  confirmToken: string;
};

export type SnapshotPurgePlan = {
  includeArchived: boolean;
  includePinned: boolean;
  olderThanDays: number;
  skippedPinned: number;
  count: number;
  bytes: number;
  ids: string[];
  confirmToken: string;
};

export type SnapshotDeleteApplyResult = {
  deleted: number;
  failed: number;
};

export async function prepareSnapshotDeleteConfirm(id: string): Promise<SnapshotDeleteConfirmInfo> {
  const dir = await ensureSnapshotDir();
  const file = path.join(dir, `${id}.json`);
  const stat = await fs.stat(file);
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw) as Partial<StoredSpawnSnapshotDoc>;
  const savedAt = String((parsed as any)?.savedAt ?? "");
  const expectedConfirmToken = createHash("sha256")
    .update(`snapdel:v1:${id}:${savedAt}:${stat.size}`)
    .digest("hex")
    .slice(0, 20);

  return { dir, file, id, expectedConfirmToken };
}

export async function deleteSnapshotFile(id: string): Promise<void> {
  const dir = await ensureSnapshotDir();
  const file = path.join(dir, `${id}.json`);
  await fs.unlink(file);
}

export async function buildSnapshotBulkDeletePlan(args: {
  ids: string[];
  includePinned: boolean;
  nowMs?: number;
}): Promise<SnapshotBulkDeletePlan> {
  const { ids, includePinned } = args;
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
  const metas = await listStoredSnapshots();
  const metaById = new Map<string, StoredSpawnSnapshotMeta>();
  for (const m of metas) metaById.set(String(m.id), m);

  const missingIds: string[] = [];
  const candidate: StoredSpawnSnapshotMeta[] = [];
  let skippedPinned = 0;
  let activeCount = 0;

  for (const id of ids) {
    const m = metaById.get(id);
    if (!m) {
      missingIds.push(id);
      continue;
    }

    if (!includePinned && Boolean((m as any).isPinned)) {
      skippedPinned += 1;
      continue;
    }

    const expired = isExpired((m as any).expiresAt, nowMs);
    const archived = Boolean((m as any).isArchived);
    if (!expired && !archived) activeCount += 1;

    candidate.push(m);
  }

  const candidateIds = candidate.map((m) => String(m.id)).sort((a, b) => a.localeCompare(b));
  const totalBytes = candidate.reduce((acc, m) => acc + Number((m as any).bytes ?? 0), 0);
  const tokenMaterial = candidate
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((m) => `${m.id}:${String((m as any).savedAt ?? "")}:${Number((m as any).bytes ?? 0)}`)
    .join("|");

  const confirmToken = createHash("sha1")
    .update(`bulkdel|${includePinned ? "P" : "p"}|${tokenMaterial}|missing:${missingIds.length}|active:${activeCount}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();

  return {
    includePinned,
    requested: ids.length,
    found: ids.length - missingIds.length,
    missing: missingIds.length,
    missingIds,
    skippedPinned,
    activeCount,
    count: candidateIds.length,
    bytes: totalBytes,
    ids: candidateIds,
    confirmToken,
  };
}

export async function buildSnapshotPurgePlan(args: {
  includeArchived: boolean;
  includePinned: boolean;
  olderThanDays: number;
  nowMs?: number;
}): Promise<SnapshotPurgePlan> {
  const { includeArchived, includePinned, olderThanDays } = args;
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
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
  const bytes = candidates.reduce((acc, c) => acc + Number((c as any).bytes ?? 0), 0);
  const confirmToken = createHash("sha1")
    .update(`purge|${includeArchived ? "A" : "a"}|${includePinned ? "P" : "p"}|${olderThanDays}|${ids.join(",")}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();

  return {
    includeArchived,
    includePinned,
    olderThanDays,
    skippedPinned,
    count: ids.length,
    bytes,
    ids,
    confirmToken,
  };
}

export async function deleteSnapshotFiles(ids: readonly string[]): Promise<SnapshotDeleteApplyResult> {
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

  return { deleted, failed };
}
