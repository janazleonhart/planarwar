// worldcore/test/contract_adminSpellsSchemaColumns.test.ts
// Contract guard: schema contains the columns used by the adminSpells editor.
//
// This test scans ALL schema files under worldcore/infra/schema so it is stable
// even when we add ALTER TABLE migrations later.

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
  // Remove -- line comments and /* */ blocks. Simple but good enough for schema parsing.
  const noLine = sql.replace(/--.*$/gm, "");
  return noLine.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractSpellColumnsFromCreate(sql: string): string[] {
  const cleaned = stripSqlComments(sql);

  // Match ANY CREATE TABLE ... ( ... ) blocks, then pick the one for spells.
  // Handles qualified names like public.spells, quoted identifiers, and IF NOT EXISTS.
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([^\(]+)\(([^;]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  let inside = "";
  while ((m = createRe.exec(cleaned))) {
    const tableRaw = m[1].trim();
    const norm = tableRaw
      .replace(/\s+/g, "")
      .replace(/"/g, "")
      .toLowerCase();
    if (norm.endsWith("spells") || norm.endsWith(".spells")) {
      inside = m[2];
      break;
    }
  }
  if (!inside) return [];
  const cols: string[] = [];

  // Split by commas, but tolerate commas inside parens (e.g., numeric(10,2)).
  // We'll do a small state machine.
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

    // Ignore constraints / indexes inside create-table blocks.
    if (/^(constraint|primary\s+key|unique|foreign\s+key|check)\b/i.test(line)) continue;

    // Column name is first token (possibly quoted).
    const colMatch =
      line.match(/^"([^"]+)"\s+/) ||
      line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/);
    if (!colMatch) continue;

    const col = (colMatch[1] || colMatch[0])
      .replace(/\s+.*/, "")
      .replace(/^"|"$/g, "")
      .trim();
    if (col) cols.push(col);
  }

  return cols;
}

function extractSpellColumnsFromAlter(sql: string): string[] {
  const cleaned = stripSqlComments(sql);

  const cols: string[] = [];
  // Capture: ALTER TABLE [schema.]spells ADD COLUMN [IF NOT EXISTS] col_name
  const re = /alter\s+table\s+(?:if\s+exists\s+)?(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?spells\s+add\s+column\s+(?:if\s+not\s+exists\s+)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const raw = m[1];
    const col = raw.replace(/^"|"$/g, "");
    cols.push(col);
  }
  return cols;
}

function collectSpellColumns(schemaDir: string): Set<string> {
  const files = listSqlFiles(schemaDir);
  assert.ok(files.length > 0, `Expected schema .sql files under ${schemaDir}`);

  const cols = new Set<string>();
  for (const f of files) {
    const sql = readTextOrFail(f);
    for (const c of extractSpellColumnsFromCreate(sql)) cols.add(c);
    for (const c of extractSpellColumnsFromAlter(sql)) cols.add(c);
  }
  return cols;
}

test("[contract] spells table contains columns used by adminSpells editor", () => {
  const repoRoot = repoRootFromDistTestDir();
  const schemaDir = path.join(repoRoot, "worldcore", "infra", "schema");

  const cols = collectSpellColumns(schemaDir);

  // Columns referenced by web-backend/routes/adminSpells.ts.
  const required = [
    "id",
    "name",
    "description",
    "kind",
    "class_id",
    "min_level",
    "school",
    "is_song",
    "song_school",
    "resource_type",
    "resource_cost",
    "cooldown_ms",
    "damage_multiplier",
    "flat_bonus",
    "heal_amount",
    "flags",
    "status_effect",
    "cleanse",
    "tags",
    "is_debug",
    "is_enabled",
    "created_at",
    "updated_at",
  ];

  const missing = required.filter((c) => !cols.has(c));
  assert.equal(
    missing.length,
    0,
    `spells schema missing columns: ${missing.join(", ")}`,
  );
});
