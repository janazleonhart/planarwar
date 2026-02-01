// worldcore/test/contract_adminItemsSchemaColumns.test.ts
// Contract guard: schema contains the columns required by the adminItems editor.
//
// This test scans ALL schema files under worldcore/infra/schema so it is stable
// even when we add ALTER TABLE migrations later.
//
// Unlike spells, we haven't standardized item "kind/tags/enabled" naming yet.
// Keep this conservative: enforce the minimum set that the editor can't function without,
// and avoid hard-coding speculative column names.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function listSqlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort()
    .map((f) => path.join(dir, f));
}

function stripSqlComments(sql: string): string {
  const noLine = sql.replace(/--.*$/gm, "");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractTableColumnsFromCreate(sql: string, tableName: string): string[] {
  const cleaned = stripSqlComments(sql);

  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([^\(]+)\(([^;]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  let inside = "";
  while ((m = createRe.exec(cleaned))) {
    const tableRaw = m[1].trim();
    const norm = tableRaw.replace(/\s+/g, "").replace(/"/g, "").toLowerCase();
    const t = tableName.toLowerCase();
    if (norm.endsWith(t) || norm.endsWith("." + t)) {
      inside = m[2];
      break;
    }
  }
  if (!inside) return [];

  const cols: string[] = [];
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of inside) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf);

  for (const raw of parts) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(constraint|primary\s+key|unique|foreign\s+key|check)\b/i.test(line)) continue;

    const colMatch =
      line.match(/^"([^"]+)"\s+/) || line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/);
    if (!colMatch) continue;

    const col = (colMatch[1] || colMatch[0])
      .replace(/\s+.*/, "")
      .replace(/^"|"$/g, "")
      .trim();
    if (col) cols.push(col);
  }
  return cols;
}

function extractTableColumnsFromAlter(sql: string, tableName: string): string[] {
  const cleaned = stripSqlComments(sql);

  const cols: string[] = [];
  const t = tableName.toLowerCase();
  const re = new RegExp(
    String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?${t}\s+add\s+column\s+(?:if\s+not\s+exists\s+)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const raw = m[1];
    const col = raw.replace(/^"|"$/g, "");
    cols.push(col);
  }
  return cols;
}

function collectTableColumns(schemaDir: string, tableName: string): Set<string> {
  const files = listSqlFiles(schemaDir);
  assert.ok(files.length > 0, `Expected schema .sql files under ${schemaDir}`);

  const cols = new Set<string>();
  for (const f of files) {
    const sql = readTextOrFail(f);
    for (const c of extractTableColumnsFromCreate(sql, tableName)) cols.add(c);
    for (const c of extractTableColumnsFromAlter(sql, tableName)) cols.add(c);
  }
  return cols;
}

function requireAll(cols: Set<string>, required: string[]): string[] {
  return required.filter((c) => !cols.has(c));
}

test("[contract] items table contains minimum columns for adminItems editor", () => {
  const repoRoot = repoRootFromDistTestDir();
  const schemaDir = path.join(repoRoot, "worldcore", "infra", "schema");

  const cols = collectTableColumns(schemaDir, "items");

  // Minimum viability:
  // - list needs id + name
  // - editor needs description (nullable is fine)
  // - audit/maintenance relies on timestamps
  const requiredCore = ["id", "name", "description", "created_at", "updated_at"];

  const missing = requireAll(cols, requiredCore);
  assert.equal(
    missing.length,
    0,
    `items schema contract failed: missing minimum columns: ${missing.join(", ")}`,
  );
});
