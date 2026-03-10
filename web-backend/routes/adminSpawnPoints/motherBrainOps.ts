import {
  addReasonExplainStep,
  makeProtectedReasonFromRow,
  makeReasonMaps,
  type MotherBrainListRow,
  type MotherBrainOpsPreview,
} from "./opsPreview";

const PREVIEW_LIMIT = 75;

function uniqueSpawnIds(values: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = String(value ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function truncateIds(values: string[], limit = PREVIEW_LIMIT): string[] {
  return values.slice(0, limit);
}

export function buildMotherBrainWaveOpsPreview(args: {
  plannedActions: any[];
  filteredActions: any[];
  effectiveExistingSpawnIds: Iterable<string>;
  existingBrainSpawnIds: string[];
  append: boolean;
  updateExisting: boolean;
}): MotherBrainOpsPreview {
  const plannedAllSpawnIds: string[] = (args.plannedActions ?? [])
    .map((a: any) => String(a?.spawn?.spawnId ?? ""))
    .filter(Boolean);

  const filteredSpawnIds: string[] = (args.filteredActions ?? [])
    .filter((a: any) => a && a.kind === "place_spawn")
    .map((a: any) => String(a?.spawn?.spawnId ?? ""))
    .filter(Boolean);

  const filteredUnique = uniqueSpawnIds(filteredSpawnIds);
  const plannedUnique = uniqueSpawnIds(plannedAllSpawnIds);
  const filteredSet = new Set<string>(filteredUnique);
  const existingSet = new Set<string>(Array.from(args.effectiveExistingSpawnIds ?? []).map((sid) => String(sid ?? "")));

  const dupCounts = new Map<string, number>();
  for (const sid of filteredSpawnIds) dupCounts.set(sid, (dupCounts.get(sid) ?? 0) + 1);
  const duplicatePlannedSpawnIds = Array.from(dupCounts.entries())
    .filter(([_, n]) => n > 1)
    .map(([sid]) => sid)
    .sort((a, b) => a.localeCompare(b));

  const insertSpawnIds: string[] = [];
  const updateSpawnIds: string[] = [];
  const skipSpawnIds: string[] = [];

  for (const sid of filteredUnique) {
    if (existingSet.has(sid)) {
      if (args.updateExisting) updateSpawnIds.push(sid);
      else skipSpawnIds.push(sid);
    } else {
      insertSpawnIds.push(sid);
    }
  }

  const droppedPlannedSpawnIds = plannedUnique.filter((sid) => !filteredSet.has(sid));
  const deleteSpawnIds = !args.append
    ? [...(args.existingBrainSpawnIds ?? [])]
        .map((sid) => String(sid ?? ""))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    : [];

  return {
    limit: PREVIEW_LIMIT,
    truncated:
      deleteSpawnIds.length > PREVIEW_LIMIT ||
      insertSpawnIds.length > PREVIEW_LIMIT ||
      updateSpawnIds.length > PREVIEW_LIMIT ||
      skipSpawnIds.length > PREVIEW_LIMIT ||
      duplicatePlannedSpawnIds.length > PREVIEW_LIMIT ||
      droppedPlannedSpawnIds.length > PREVIEW_LIMIT,
    deleteSpawnIds: deleteSpawnIds.length ? truncateIds(deleteSpawnIds) : undefined,
    insertSpawnIds: insertSpawnIds.length ? truncateIds(insertSpawnIds) : undefined,
    updateSpawnIds: updateSpawnIds.length ? truncateIds(updateSpawnIds) : undefined,
    skipSpawnIds: skipSpawnIds.length ? truncateIds(skipSpawnIds) : undefined,
    duplicatePlannedSpawnIds: duplicatePlannedSpawnIds.length ? truncateIds(duplicatePlannedSpawnIds) : undefined,
    droppedPlannedSpawnIds: droppedPlannedSpawnIds.length ? truncateIds(droppedPlannedSpawnIds) : undefined,
  };
}

export function buildMotherBrainWipeOpsPreview(selectedSpawnIds: Iterable<string>): MotherBrainOpsPreview {
  const deleteSpawnIds = uniqueSpawnIds(Array.from(selectedSpawnIds ?? []).map((sid) => String(sid ?? ""))).sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    limit: PREVIEW_LIMIT,
    truncated: deleteSpawnIds.length > PREVIEW_LIMIT,
    deleteSpawnIds: deleteSpawnIds.length ? truncateIds(deleteSpawnIds) : undefined,
  };
}

export function buildWipeListRows(args: {
  selectedSpawnIds: Iterable<string>;
  bySpawnId: Map<string, { id: number; row: MotherBrainListRow }>;
  wantList: boolean;
  limit: number;
}): { ids: number[]; listRows: MotherBrainListRow[] } {
  const ids: number[] = [];
  const listRows: MotherBrainListRow[] = [];

  for (const sid of args.selectedSpawnIds ?? []) {
    const hit = args.bySpawnId.get(String(sid ?? ""));
    if (!hit) continue;
    ids.push(hit.id);
    if (args.wantList && listRows.length < args.limit) listRows.push(hit.row);
  }

  return { ids, listRows };
}

export function applyProtectedPreviewRows(args: {
  opsPreview: MotherBrainOpsPreview;
  rows: Array<{ spawn_id?: unknown; owner_kind?: unknown; is_locked?: unknown }>;
}): MotherBrainOpsPreview {
  const explain = makeReasonMaps();
  const protectedSet = new Set<string>();

  for (const row of args.rows ?? []) {
    const sid = String(row?.spawn_id ?? "");
    if (!sid) continue;
    protectedSet.add(sid);
    addReasonExplainStep(
      explain,
      sid,
      makeProtectedReasonFromRow(row),
      "row is protected by ownership/lock rules",
      {
        spawnId: sid,
        ownerKind: typeof row?.owner_kind === "string" ? row.owner_kind : null,
        isLocked: Boolean(row?.is_locked),
      },
    );
  }

  const protectedDelete = (args.opsPreview.deleteSpawnIds ?? []).filter((sid) => protectedSet.has(String(sid)));
  const protectedUpdate = (args.opsPreview.updateSpawnIds ?? []).filter((sid) => protectedSet.has(String(sid)));

  if (protectedDelete.length) args.opsPreview.protectedDeleteSpawnIds = truncateIds(protectedDelete);
  if (protectedUpdate.length) args.opsPreview.protectedUpdateSpawnIds = truncateIds(protectedUpdate);
  if (protectedDelete.length > PREVIEW_LIMIT || protectedUpdate.length > PREVIEW_LIMIT) {
    args.opsPreview.truncated = true;
  }

  if (Object.keys(explain.reasons).length) {
    (args.opsPreview as any).reasons = explain.reasons;
    (args.opsPreview as any).reasonCounts = explain.reasonCounts;
    (args.opsPreview as any).reasonDetails = explain.reasonDetails;
    (args.opsPreview as any).reasonChains = explain.reasonChains;
  }

  return args.opsPreview;
}

export { PREVIEW_LIMIT };
