//web-backend/routes/adminSpawnPoints/protoCatalogOps.ts

import { promises as fs } from "node:fs";
import path from "node:path";

import { db } from "../../../worldcore/db/Database";

export type ProtoOptionKind = "resource" | "station";
export type ProtoOption = { id: string; label: string; kind: ProtoOptionKind };

export type LoadProtoOptionsPayloadArgs = {
  cwd: string;
  dirname: string;
  getStationProtoIdsForTier: (tier: number) => string[];
};

function uniqSorted(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function resolveResourcesDir(args: { cwd: string; dirname: string }): Promise<{ dir: string | null; tried: string[] }> {
  const tried: string[] = [];
  const candidates = [
    path.resolve(args.cwd, "web-backend", "data", "resources"),
    path.resolve(args.cwd, "data", "resources"),
    path.resolve(args.dirname, "..", "data", "resources"),
    path.resolve(args.dirname, "..", "..", "data", "resources"),
    path.resolve(args.dirname, "..", "..", "..", "web-backend", "data", "resources"),
  ];

  for (const candidate of candidates) {
    tried.push(candidate);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return { dir: candidate, tried };
    } catch {
      // ignore
    }
  }

  return { dir: null, tried };
}

async function loadResourceProtoIdsFromDataDir(args: { cwd: string; dirname: string }): Promise<{ ids: string[]; dir: string | null; tried: string[] }> {
  const { dir, tried } = await resolveResourcesDir(args);
  if (!dir) return { ids: [], dir: null, tried };

  const ids: string[] = [];
  const files = (await fs.readdir(dir)).filter((file) => file.toLowerCase().endsWith(".json"));

  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const raw = await fs.readFile(full, "utf-8");
      const data = JSON.parse(raw);

      if (Array.isArray(data)) {
        for (const row of data) {
          const id = row && typeof row.id === "string" ? row.id : null;
          if (id) ids.push(id);
        }
      }
    } catch {
      // Ignore parse errors; this is an admin convenience endpoint.
    }
  }

  return { ids: uniqSorted(ids), dir, tried };
}

function toTitle(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\w/g, (char) => char.toUpperCase());
}

export async function loadProtoOptionsPayload(args: LoadProtoOptionsPayloadArgs): Promise<{
  protoOptions: ProtoOption[];
  resourceProtoIds: string[];
  stationProtoIds: string[];
  resourcesDir: string | null;
}> {
  const resources = await loadResourceProtoIdsFromDataDir({ cwd: args.cwd, dirname: args.dirname });

  const stationIds: string[] = [];
  for (let tier = 1; tier <= 10; tier += 1) {
    try {
      stationIds.push(...args.getStationProtoIdsForTier(tier));
    } catch {
      // ignore
    }
  }

  const resourceIds = resources.ids;
  const stations = uniqSorted(stationIds);

  const itemLabels = new Map<string, string>();
  if (resourceIds.length) {
    try {
      const result = await db.query("SELECT id, name FROM items WHERE id = ANY($1::text[])", [resourceIds]);
      for (const row of result.rows ?? []) {
        if (row?.id && row?.name) itemLabels.set(String(row.id), String(row.name));
      }
    } catch {
      // ignore
    }
  }

  const protoOptions: ProtoOption[] = [
    ...resourceIds.map((id) => ({
      id,
      kind: "resource" as const,
      label: itemLabels.get(id) ? `${itemLabels.get(id)} (${id})` : `${toTitle(id)} (${id})`,
    })),
    ...stations.map((id) => ({
      id,
      kind: "station" as const,
      label: `Station: ${toTitle(id)} (${id})`,
    })),
  ];

  return {
    protoOptions,
    resourceProtoIds: resourceIds,
    stationProtoIds: stations,
    resourcesDir: resources.dir,
  };
}
