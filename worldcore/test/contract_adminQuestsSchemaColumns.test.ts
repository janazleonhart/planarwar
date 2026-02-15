// worldcore/test/contract_adminQuestsSchemaColumns.test.ts
// Contract guard: schema contains the columns required by the Admin Quests editor.
//
// The editor uses:
// - quests (021_quests.sql + follow-on migrations)
// - quest_objectives (022_quest_objectives.sql)
// - quest_rewards (023_quest_rewards.sql)

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  repoRootFromDistTestDir,
  collectTableColumns,
  requireAll,
} from "./contract_schemaHelpers";

function assertHasColumns(table: string, cols: Set<string>, required: string[]): void {
  const missing = requireAll(cols, required);
  assert.equal(
    missing.length,
    0,
    `${table} schema contract failed: missing columns: ${missing.join(", ")}`,
  );
}

test("[contract] quests tables contain columns used by adminQuests editor", () => {
  const repoRoot = repoRootFromDistTestDir();
  const schemaDir = path.join(repoRoot, "worldcore", "infra", "schema");

  const questsCols = collectTableColumns(schemaDir, "quests");
  assertHasColumns("quests", questsCols, [
    "id",
    "name",
    "description",
    "repeatable",
    "max_repeats",
    "min_level",
    "category",
    "tags",
    "is_enabled",
    "designer",
    "notes",
    "turnin_policy",
    "turnin_npc_id",
    "turnin_board_id",
    "created_at",
    "updated_at",
  ]);

  const objCols = collectTableColumns(schemaDir, "quest_objectives");
  assertHasColumns("quest_objectives", objCols, [
    "id",
    "quest_id",
    "idx",
    "kind",
    "target_id",
    "required",
    "extra_json",
  ]);

  const rewardsCols = collectTableColumns(schemaDir, "quest_rewards");
  assertHasColumns("quest_rewards", rewardsCols, [
    "id",
    "quest_id",
    "kind",
    "amount",
    "item_id",
    "item_qty",
    "title_id",
    "extra_json",
  ]);
});
