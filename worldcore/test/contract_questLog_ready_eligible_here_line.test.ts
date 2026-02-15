// worldcore/test/contract_questLog_ready_eligible_here_line.test.ts
//
// Contract: When a MudContext is available, READY quests in the quest log should
// explicitly indicate whether they are eligible to be turned in *here*.

import assert from "node:assert/strict";
import test from "node:test";

import type { CharacterState } from "../characters/CharacterTypes";
import {
  defaultAbilities,
  defaultAttributes,
  defaultEquipment,
  defaultInventory,
  defaultProgression,
  defaultSpellbook,
} from "../characters/CharacterTypes";

import type { QuestDefinition } from "../quests/QuestTypes";
import { ensureQuestState } from "../quests/QuestState";
import { renderQuestLog } from "../quests/QuestText";

function makeChar(): CharacterState {
  return {
    id: "char_test_questlog_eligible_here_1",
    userId: "user_test_questlog_eligible_here_1",
    shardId: "prime_shard",

    name: "Tester",
    classId: "warrior",
    raceId: "human",

    level: 1,
    xp: 0,

    posX: 0,
    posY: 0,
    posZ: 0,

    lastRegionId: null,
    appearanceTag: null,

    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    abilities: defaultAbilities(),
    spellbook: defaultSpellbook(),
    progression: defaultProgression(),

    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

function makeCtx(char: CharacterState, roomId: string, regionId: string) {
  const selfEnt = {
    id: "ent_player_1",
    type: "player",
    name: char.name,
    roomId,
    x: 0,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    ownerSessionId: "sess_test_1",
  } as any;

  return {
    session: {
      id: "sess_test_1",
      identity: { userId: char.userId },
      character: char,
    },
    entities: {
      getEntityByOwner(sessId: string) {
        return sessId === selfEnt.ownerSessionId ? selfEnt : null;
      },
    },
    rooms: {
      getRoom(_rid: string) {
        return { id: roomId, regionId };
      },
    },
  } as any;
}

test("[contract] quest log READY rows show Eligible to turn in here: YES/NO when ctx present", async () => {
  const char = makeChar();

  const quest: QuestDefinition = {
    id: "policy_board_eligible_here_test",
    name: "Policy Board Eligible Here Test",
    description: "Turn me in at a specific quest board.",
    turninPolicy: "board",
    turninBoardId: "town_a",
    objectives: [],
    reward: { xp: 1 },
  } as any;

  const qs = ensureQuestState(char);
  qs[quest.id] = {
    state: "completed",
    completions: 0,
    source: {
      kind: "service",
      service: "test",
      questId: quest.id,
      def: quest,
    },
  } as any;

  const ctxA = makeCtx(char, "prime_shard:0,0", "town_a");
  const logA = renderQuestLog(char, { ctx: ctxA, filter: "ready" });
  assert.ok(logA.includes("[READY]"), logA);
  assert.ok(logA.includes("[HERE]"), logA);
  assert.ok(logA.includes("Eligible to turn in here: YES"), logA);

  const ctxB = makeCtx(char, "prime_shard:0,0", "town_b");
  const logB = renderQuestLog(char, { ctx: ctxB, filter: "ready" });
  assert.ok(logB.includes("Eligible to turn in here: NO"), logB);
  assert.ok(logB.toLowerCase().includes("turn-in") && logB.includes("town_a"), logB);
});
