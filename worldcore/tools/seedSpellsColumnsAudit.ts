// worldcore/tools/seedSpellsColumnsAudit.ts

import fs from "node:fs";
import path from "node:path";

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function extractColumnNames(createTableSql: string): Set<string> {
  const m = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?spells\s*\(([^]*?)\)\s*;/i.exec(createTableSql);
  if (!m) return new Set();

  const body = m[1];
  const cols = new Set<string>();

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/--.*$/, "").trim().replace(/,$/, "");
    if (!line) continue;
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(line)) continue;

    const mm = /^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+/i.exec(line);
    if (mm) cols.add(mm[1]);
  }

  return cols;
}

function main(): void {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const schemaFile = path.join(repoRoot, "worldcore/infra/schema/040_create_spells_table.sql");

  if (!fs.existsSync(schemaFile)) {
    die(`[seedSpellsColumnsAudit] missing schema file: ${schemaFile}`);
  }

  const sql = fs.readFileSync(schemaFile, "utf8");
  const cols = extractColumnNames(sql);

  if (cols.size === 0) {
    die(`[seedSpellsColumnsAudit] FAIL: could not parse spells CREATE TABLE block schemaFile=${schemaFile}`);
  }

  // Keep this list aligned with 040_create_spells_table.sql and web-backend/routes/adminSpells.ts.
  const required = [
    "id",
    "name",
    "description",
    "tags",
    "kind",
    "class_id",
    "min_level",
    "school",
    "is_song",
    "song_school",
    "resource_type",
    "resource_cost",
    "cooldown_ms",
    "gcd_ms",
    "cast_ms",
    "target_kind",
    "is_aoe",
    "range_meters",
    "radius_meters",
    "resource_kind",
    "damage_kind",
    "damage_base",
    "damage_scaling",
    "damage_mult",
    "heal_base",
    "heal_scaling",
    "heal_mult",
    "hot_amount",
    "hot_every_ms",
    "hot_ticks",
    "shield_amount",
    "duration_ms",
    "flags_json",
    "status_effect_json",
    "cleanse_json",
    "is_debug",
    "is_enabled",
    "created_at",
    "updated_at",
  ];

  const missing = required.filter((c) => !cols.has(c));
  if (missing.length) {
    die(
      `[seedSpellsColumnsAudit] FAIL: missing columns: ${missing.join(", ")} schemaFile=${schemaFile}`
    );
  }

  console.log(`[seedSpellsColumnsAudit] OK: requiredColumns=${required.length} schemaFile=${schemaFile}`);
}

main();
