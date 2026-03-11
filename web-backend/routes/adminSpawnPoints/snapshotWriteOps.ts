//web-backend/routes/adminSpawnPoints/snapshotWriteOps.ts

import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  allocateSnapshotIdUnique,
  ensureSnapshotDir,
  metaFromStoredDoc,
  safeSnapshotName,
  safeSnapshotNotes,
  normalizeSnapshotTags,
  type StoredSpawnSnapshotDoc,
  type StoredSpawnSnapshotMeta,
} from "./snapshotStore";
import { buildUpdatedSnapshotDoc } from "./snapshotResponses";

export async function updateStoredSnapshotFromBody(args: {
  doc: StoredSpawnSnapshotDoc;
  id: string;
  body: any;
}): Promise<StoredSpawnSnapshotMeta> {
  const { doc, id, body } = args;
  const updated = buildUpdatedSnapshotDoc({
    doc,
    nameRaw: body?.name ?? null,
    tagsRaw: body?.tags,
    notesRaw: body?.notes,
    isArchivedRaw: body?.isArchived,
    isPinnedRaw: body?.isPinned,
    expiresAtRaw: body?.expiresAt,
    normalizeTags: normalizeSnapshotTags,
    safeName: safeSnapshotName,
  });

  const dir = await ensureSnapshotDir();
  const file = path.join(dir, `${id}.json`);
  await fs.writeFile(file, JSON.stringify(updated, null, 2) + "\n", "utf8");

  const raw = await fs.readFile(file, "utf8");
  const bytes = Buffer.byteLength(raw, "utf8");
  return metaFromStoredDoc(updated, bytes);
}

export async function duplicateStoredSnapshotFromBody(args: {
  doc: StoredSpawnSnapshotDoc;
  body: any;
}): Promise<StoredSpawnSnapshotMeta> {
  const { doc, body } = args;
  const nameRaw = body?.name;
  const tagsRaw = body?.tags;
  const notesRaw = body?.notes;

  const baseName = safeSnapshotName(nameRaw ? nameRaw : `${doc.name} copy`);
  const shardId = doc.snapshot.shardId;
  const bounds = doc.snapshot.bounds;
  const types = Array.isArray(doc.snapshot.types) ? doc.snapshot.types : [];

  const newId = await allocateSnapshotIdUnique(baseName, shardId, bounds, types);
  const now = new Date().toISOString();

  const tags = tagsRaw === undefined ? (Array.isArray((doc as any).tags) ? (doc as any).tags : []) : normalizeSnapshotTags(tagsRaw);
  const notes = notesRaw === undefined ? ((doc as any).notes ?? null) : safeSnapshotNotes(notesRaw);

  const cloned: StoredSpawnSnapshotDoc = {
    kind: "admin.stored-spawn-snapshot",
    version: 3,
    id: newId,
    name: baseName,
    savedAt: now,
    tags,
    notes,
    isArchived: false,
    isPinned: false,
    expiresAt: null,
    snapshot: doc.snapshot,
  };

  const dir = await ensureSnapshotDir();
  const file = path.join(dir, `${newId}.json`);
  const raw = JSON.stringify(cloned, null, 2) + "\n";
  await fs.writeFile(file, raw, "utf8");

  const bytes = Buffer.byteLength(raw, "utf8");
  return metaFromStoredDoc(cloned, bytes);
}
