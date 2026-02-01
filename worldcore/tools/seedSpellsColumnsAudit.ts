// worldcore/tools/seedSpellsColumnsAudit.ts
//
// Audit: ensure the spells table schema (across ALL migrations) contains the columns
// required by the Admin Spells editor + seed expectations.
//
// Why this exists:
// - CREATE TABLE lives in 040_create_spells_table.sql.
// - Later migrations may ADD columns (e.g., 050_add_spell_effect_payloads_v1.sql).
// - We want a drift tripwire that stays correct even as we add ALTER TABLE migrations.

import fs from "node:fs";
import path from "node:path";

type AuditResult = {
  ok: boolean;
  schemaDir: string;
  requiredColumns: string[];
  missingColumns: string[];
  filesScanned: number;
};

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function repoRootFromDistToolsDir(): string {
  // __dirname = <repo>/dist/worldcore/tools
  return path.resolve(__dirname, "../../..");
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
  const createRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([^\(]+)\(([^;]*?)\)\s*;/gi;

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

  // Split by commas, but tolerate commas inside parens (e.g., numeric(10,2)).
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

  const cols: string[] = [];
  for (const raw of parts) {
    const line = raw.trim();
    if (!line) continue;

    // Ignore constraints / indexes inside create-table blocks.
    if (/^(constraint|primary\s+key|unique|foreign\s+key|check)\b/i.test(line))
      continue;

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

  // Capture: ALTER TABLE [schema.]spells ADD COLUMN [IF NOT EXISTS] col_name
  const cols: string[] = [];
  const re =
    /alter\s+table\s+(?:if\s+exists\s+)?(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?spells\s+add\s+column\s+(?:if\s+not\s+exists\s+)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const raw = m[1];
    cols.push(raw.replace(/^"|"$/g, ""));
  }
  return cols;
}

function collectSpellColumns(schemaDir: string): { cols: Set<string>; filesScanned: number } {
  const files = listSqlFiles(schemaDir);
  if (!files.length) {
    die(`[seedSpellsColumnsAudit] FAIL: no .sql files found schemaDir=${schemaDir}`);
  }

  const cols = new Set<string>();
  for (const f of files) {
    const sql = fs.readFileSync(f, "utf8");
    for (const c of extractSpellColumnsFromCreate(sql)) cols.add(c);
    for (const c of extractSpellColumnsFromAlter(sql)) cols.add(c);
  }

  if (cols.size === 0) {
    die(`[seedSpellsColumnsAudit] FAIL: could not find spells CREATE TABLE in schemaDir=${schemaDir}`);
  }

  return { cols, filesScanned: files.length };
}

function parseArgs(argv: string[]): { schemaDir?: string; json?: boolean } {
  const out: { schemaDir?: string; json?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--schemaDir") out.schemaDir = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "seedSpellsColumnsAudit",
          "",
          "Usage:",
          "  node dist/worldcore/tools/seedSpellsColumnsAudit.js [--schemaDir <dir>] [--json]",
          "",
          "Defaults:",
          "  --schemaDir <repo>/worldcore/infra/schema",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromDistToolsDir();
  const schemaDir =
    args.schemaDir ?? path.join(repoRoot, "worldcore", "infra", "schema");

  const { cols, filesScanned } = collectSpellColumns(schemaDir);

  // Keep this list aligned with:
  // - web-backend/routes/adminSpells.ts
  // - worldcore/test/contract_adminSpellsSchemaColumns.test.ts
  // - worldcore/infra/schema migrations for spells
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

  const result: AuditResult = {
    ok: missing.length === 0,
    schemaDir,
    requiredColumns: required,
    missingColumns: missing,
    filesScanned,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (!result.ok) {
    die(
      `[seedSpellsColumnsAudit] FAIL: missing columns: ${missing.join(", ")} schemaDir=${schemaDir}`,
    );
  }

  console.log(
    `[seedSpellsColumnsAudit] OK: filesScanned=${filesScanned} schemaDir=${schemaDir}`,
  );
}

main();
