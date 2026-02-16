// worldcore/test/contract_quest_show_prereqs_and_unlocks_status.test.ts
//
// Contract (Questloop UX):
// - `quest show <id>` should render prerequisite status and follow-up unlock status.
// - Follow-ups unlocked by a turned-in quest and not yet accepted should be marked as [NEW].

import test from "node:test";
import assert from "node:assert/strict";

import { renderQuestDetails } from "../quests/QuestText";
import { ensureQuestState } from "../quests/QuestState";

test("[contract] quest show renders prereq status + follow-up status", () => {
  const char = makeChar();

  // Mark chain intro quest as turned in once.
  const state = ensureQuestState(char as any);
  state["chain_intro_test"] = {
    state: "turned_in",
    completions: 1,
    source: { kind: "registry" },
  } as any;

  const intro = renderQuestDetails(char as any, "chain_intro_test");
  assert.match(intro, /Unlocks \(follow-ups\):/);
  assert.match(intro, /\- \[NEW\] Chain Follow-up Test \(chain_followup_test\)/);

  const followup = renderQuestDetails(char as any, "chain_followup_test");
  assert.match(followup, /Prerequisites \(must be turned in\):/);
  assert.match(followup, /\- \[DONE\] Chain Intro Test \(chain_intro_test\)/);
});

function makeChar(): any {
  return {
    userId: "user_show_prereq_unlocks",
    id: "char_show_prereq_unlocks",
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
