// worldcore/test/contract_townQuestGenerator_noUnderfill_noDuplicateIds.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { generateTownQuests } from "../quests/QuestGenerator";

test("[contract] town quest generator v0 does not underfill and never emits duplicate quest ids", () => {
  const base = { townId: "prime_shard:0,0", epoch: "test_epoch" };
  const maxQuests = 6;

  // Tier 2 has multiple deterministic inclusions (greet, rat culling, gather, optional repeatable)
  // plus a candidate pool. If any candidate collides with an existing id, we should still fill.
  const quests = generateTownQuests({ ...base, tier: 2, maxQuests, includeRepeatables: true });

  assert.equal(quests.length, maxQuests);

  const ids = quests.map((q) => String((q as any)?.id ?? "").trim()).filter(Boolean);
  assert.equal(ids.length, maxQuests);
  assert.equal(new Set(ids).size, ids.length);
});
