// worldcore/test/contract_adminAbilitiesSchemaColumns.test.ts
// Contract guard: abilities table contains the columns used by the admin abilities editor.
//
// This is a structural schema contract (no DB). It scans worldcore/infra/schema/*.sql
// and ensures the expected columns appear in the migrations for public.abilities.

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

test("[contract] abilities table contains columns used by adminAbilities editor", () => {
  const repoRoot = repoRootFromDistTestDir();
  const sql = readAllSchemaSql(repoRoot);

  // Markers: we want to be sure we're looking at the abilities table section.
  assert.ok(/CREATE TABLE IF NOT EXISTS public\.abilities/i.test(sql), "Expected public.abilities table to exist in schema migrations");

  mustAllContain(
    sql,
    [
      "public.abilities",
      "id text PRIMARY KEY",
      "name text NOT NULL",
      "description text",
      "kind text",
      "resource_type",
      "resource_cost",
      "cooldown_ms",
      "is_enabled",
      "is_debug",
      "is_dev_only",
      "grant_min_role",
      "flags jsonb",
      "tags text",
      "created_at",
      "updated_at",
    ],
    "abilities",
  );
});
