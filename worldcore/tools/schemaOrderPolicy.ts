// worldcore/tools/schemaOrderPolicy.ts
//
// Single source of truth for how we order schema SQL files.

import fs from "node:fs";

export type SchemaNumericPrefix = { raw: string; num: number };

export function parseSchemaNumericPrefix(basename: string): SchemaNumericPrefix | null {
  const m = /^(\d+)[_-]/.exec(basename);
  if (!m) return null;
  const raw = String(m[1] ?? "");
  const num = parseInt(raw, 10);
  if (Number.isNaN(num)) return null;
  return { raw, num };
}

export function compareSchemaFilenames(a: string, b: string): number {
  const pa = parseSchemaNumericPrefix(a);
  const pb = parseSchemaNumericPrefix(b);

  if (pa && pb) {
    if (pa.num !== pb.num) return pa.num - pb.num;
    return a.localeCompare(b);
  }

  if (pa && !pb) return -1;
  if (!pa && pb) return 1;

  return a.localeCompare(b);
}

export function listSqlFilesSorted(schemaDir: string): string[] {
  if (!fs.existsSync(schemaDir)) return [];

  const entries = fs.readdirSync(schemaDir, { withFileTypes: true });
  const files: string[] = [];

  for (const e of entries) {
    if (!e.isFile()) continue;
    const name = e.name;
    if (!name.toLowerCase().endsWith(".sql")) continue;
    files.push(name);
  }

  return files.sort(compareSchemaFilenames);
}
