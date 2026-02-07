// worldcore/tools/schemaMissingMigrationsLib.ts
//
// Migration hygiene: detect when DB records say a migration was applied,
// but the corresponding SQL file no longer exists on disk.
//
// This scenario happens when someone renames/deletes a migration after it ran.
// It makes disaster recovery and new environment bootstraps painful.
//
// Policy:
// - By default, missing applied migrations are a hard error.
// - You can explicitly allow-list missing ids via a schema ignore file.

import fs from "node:fs";
import path from "node:path";

type IgnoreJsonShape = string[] | { ignore?: string[]; missing?: string[] };

export const SCHEMA_IGNORE_JSON = ".schema-ignore.json";
export const SCHEMA_IGNORE_TXT = ".schema-ignore.txt";

export function computeAppliedMissingOnDisk(params: {
  appliedIds: string[];
  diskIds: string[];
  ignoreIds?: Iterable<string>;
}): string[] {
  const disk = new Set(params.diskIds);
  const ignore = new Set(params.ignoreIds ?? []);

  const out: string[] = [];
  for (const id of params.appliedIds) {
    if (ignore.has(id)) continue;
    if (!disk.has(id)) out.push(id);
  }
  return out;
}

export function parseSchemaIgnoreJson(text: string): string[] {
  const raw = JSON.parse(text) as IgnoreJsonShape;
  if (Array.isArray(raw)) return raw.map(String);
  const a = raw.ignore ?? [];
  const b = raw.missing ?? [];
  return [...a, ...b].map(String);
}

export function parseSchemaIgnoreTxt(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));
}

export function loadSchemaMissingIgnoreList(schemaDir: string): Set<string> {
  const out = new Set<string>();

  const jsonPath = path.join(schemaDir, SCHEMA_IGNORE_JSON);
  const txtPath = path.join(schemaDir, SCHEMA_IGNORE_TXT);

  if (fs.existsSync(jsonPath)) {
    try {
      const txt = fs.readFileSync(jsonPath, "utf8");
      for (const id of parseSchemaIgnoreJson(txt)) out.add(id);
    } catch {
      // ignore parse errors; callers will treat missing as error anyway
    }
  }

  if (fs.existsSync(txtPath)) {
    try {
      const txt = fs.readFileSync(txtPath, "utf8");
      for (const id of parseSchemaIgnoreTxt(txt)) out.add(id);
    } catch {
      // ignore parse errors
    }
  }

  return out;
}
