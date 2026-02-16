// worldcore/test/contract_quest_show_unlocked_by_hint_for_followups.test.ts
//
// Contract (Quest Board UX option B):
// - `quest show <id>` should include an "Unlocked by" hint for follow-up quests
//   that are currently unlocked via turned-in parent quests.

import test from "node:test";
import assert from "node:assert/strict";

import { renderQuestDetails } from "../quests/QuestText";
import { ensureQuestState } from "../quests/QuestState";

test("[contract] quest show includes 'Unlocked by' hint for unlocked follow-ups", async () => {
  const char = makeChar();
  const st = ensureQuestState(char as any);

  // Turn in the parent quest that unlocks many follow-ups.
  st["chain_intro_multi_test"] = {
    state: "turned_in",
    completions: 1,
    source: { kind: "registry" },
  } as any;

  const out = renderQuestDetails(char as any, "chain_followup_multi_a");

  assert.match(out, /Unlocked by:/i, out);
  assert.match(out, /Chain Intro Multi Test \(chain_intro_multi_test\)/i, out);
});

function makeChar(): any {
  return {
    userId: "user_show_unlock_1",
    id: "char_show_unlock_1",
    shardId: "prime_shard",
    name: "Testy",
    classId: "warrior",
    raceId: "human",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    progression: {},
    inventory: [],
    bags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
