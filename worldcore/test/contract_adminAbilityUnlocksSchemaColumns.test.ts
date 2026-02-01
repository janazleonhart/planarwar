// worldcore/test/contract_adminAbilityUnlocksSchemaColumns.test.ts
// Contract guard: ability_unlocks table contains the columns used by the admin unlock rules editor.
//
// Structural schema contract (no DB). Scans worldcore/infra/schema/*.sql.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  return path.resolve(__dirname, "../../..");
}

function readAllSchemaSql(repoRoot: string): string {
  const schemaDir = path.join(repoRoot, "worldcore", "infra", "schema");
  assert.ok(fs.existsSync(schemaDir), `Missing schema dir: ${schemaDir}`);
  const files = fs.readdirSync(schemaDir).filter((f) => f.endsWith(".sql")).sort();
  let out = "";
  for (const f of files) {
    out += "\n\n-- FILE: " + f + "\n\n" + fs.readFileSync(path.join(schemaDir, f), "utf8");
  }
  return out;
}

function mustAllContain(sql: string, needles: string[], label: string) {
  const missing = needles.filter((n) => !sql.includes(n));
  assert.equal(missing.length, 0, `${label} schema contract failed: missing columns/markers: ${missing.join(", ")}`);
}

test("[contract] ability_unlocks table contains columns used by admin unlock editor", () => {
  const repoRoot = repoRootFromDistTestDir();
  const sql = readAllSchemaSql(repoRoot);

  assert.ok(/CREATE TABLE IF NOT EXISTS public\.ability_unlocks/i.test(sql), "Expected public.ability_unlocks table to exist in schema migrations");

  mustAllContain(
    sql,
    [
      "public.ability_unlocks",
      "class_id text NOT NULL",
      "ability_id text NOT NULL",
      "min_level",
      "auto_grant",
      "is_enabled",
      "notes text",
      "created_at",
      "updated_at",
      "PRIMARY KEY (class_id, ability_id)",
    ],
    "ability_unlocks",
  );
});
