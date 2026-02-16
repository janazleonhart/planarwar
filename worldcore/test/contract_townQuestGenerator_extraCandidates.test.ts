//worldcore/test/contract_townQuestGenerator_extraCandidates.test.ts

import { test } from "node:test";
import assert from "node:assert";
import { generateTownQuests } from "../quests/QuestGenerator";
import type { QuestDefinition } from "../quests/QuestTypes";

function mkExtraQuest(): QuestDefinition {
  return {
    id: "extra_candidate_test_talk",
    name: "Extra Candidate Test",
    description: "A tiny quest injected via extraCandidates for generator extensibility.",
    objectives: [{ kind: "talk_to", npcId: "npc_quartermaster", required: 1 }],
    reward: { xp: 1 },
    turninPolicy: "npc",
    turninNpcId: "npc_quartermaster",
  };
}

test("[contract] town quest generator supports extraCandidates hook (dedupe-safe)", () => {
  const quests = generateTownQuests({
    townId: "prime_shard:0,0",
    epoch: "test_epoch",
    tier: 1,
    maxQuests: 50,
    includeRepeatables: true,
    extraCandidates: [mkExtraQuest, mkExtraQuest],
  });

  const matches = quests.filter((q) => q.id === "extra_candidate_test_talk");
  assert.strictEqual(matches.length, 1, "expected injected quest to appear exactly once (deduped)");
});
