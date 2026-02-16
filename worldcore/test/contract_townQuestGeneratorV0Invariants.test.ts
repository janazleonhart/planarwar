// worldcore/test/contract_townQuestGeneratorV0Invariants.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { generateTownQuests } from "../quests/QuestGenerator";

function hasObjectiveKind(quests: any[], kind: string): boolean {
  return quests.some((q) => Array.isArray(q?.objectives) && q.objectives.some((o: any) => o?.kind === kind));
}

test("[contract] town quest generator v0 respects tier gating + repeatable toggle", () => {
  const base = { townId: "town_test_0_0", epoch: "2026-W03" };

  const t1 = generateTownQuests({ ...base, tier: 1, maxQuests: 6, includeRepeatables: false });
  assert.ok(t1.length >= 1);

  // First quest is always the greet quest (talk_to)
  assert.equal(t1[0]?.objectives?.[0]?.kind, "talk_to");

  // Tier 1: harvest is still gated; craft is gated.
  assert.equal(hasObjectiveKind(t1, "harvest"), false);
  assert.equal(hasObjectiveKind(t1, "craft"), false);
  assert.equal(t1.some((q) => q?.repeatable === true), false);

  const t2 = generateTownQuests({ ...base, tier: 2, maxQuests: 6, includeRepeatables: false });
  // Tier 2: harvest becomes available; craft still not.
  assert.equal(hasObjectiveKind(t2, "harvest"), true);
  assert.equal(hasObjectiveKind(t2, "craft"), false);

  const t3 = generateTownQuests({ ...base, tier: 3, maxQuests: 6, includeRepeatables: false });
  // Tier 3+: craft becomes available.
  assert.equal(hasObjectiveKind(t3, "craft"), true);
});
