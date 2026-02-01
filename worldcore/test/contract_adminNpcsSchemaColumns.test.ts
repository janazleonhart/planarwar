// worldcore/test/contract_adminNpcsSchemaColumns.test.ts
// Contract guard: schema contains the columns required by the Admin NPC editor.
//
// We enforce the columns defined by the NPC schema (024_npcs.sql) because the editor
// depends on these fields being present.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  repoRootFromDistTestDir,
  collectTableColumns,
  requireAll,
} from "./contract_schemaHelpers";

test("[contract] npcs table contains columns used by adminNpcs editor", () => {
  const repoRoot = repoRootFromDistTestDir();
  const schemaDir = path.join(repoRoot, "worldcore", "infra", "schema");

  const cols = collectTableColumns(schemaDir, "npcs");

  const required = [
    "id",
    "name",
    "level",
    "max_hp",
    "dmg_min",
    "dmg_max",
    "model",
    "tags",
    "xp_reward",
    "created_at",
    "updated_at",
  ];

  const missing = requireAll(cols, required);
  assert.equal(
    missing.length,
    0,
    `npcs schema contract failed: missing columns: ${missing.join(", ")}`,
  );
});
