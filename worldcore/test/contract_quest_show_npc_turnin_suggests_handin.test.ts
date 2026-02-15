// worldcore/test/contract_quest_show_npc_turnin_suggests_handin.test.ts
//
// Contract: when a READY quest uses turninPolicy='npc', quest show should recommend `handin <npcId>`
// (and still mention the fallback `quest turnin <id>`).

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
import { renderQuestDetails } from "../quests/QuestText";

function makeChar(): CharacterState {
  return {
    id: "char_test_show_npc_suggests_handin",
    userId: "user_test_show_npc_suggests_handin",
    shardId: "prime_shard",

    name: "Testy",
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

function makeCtx(char: CharacterState, roomId: string) {
  const selfEnt = {
    id: "ent_player_1",
    type: "player",
    name: "Testy",
    roomId,
    x: 0,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    ownerSessionId: "sess_test_show_npc_suggests_handin",
  } as any;

  return {
    session: {
      id: selfEnt.ownerSessionId,
      identity: { userId: char.userId },
      character: char,
    },
    entities: {
      _roomEnts: [] as any[],
      getEntityByOwner(sessId: string) {
        return sessId === selfEnt.ownerSessionId ? selfEnt : null;
      },
      getEntitiesInRoom(_rid: string) {
        return (this as any)._roomEnts;
      },
    },
    rooms: {
      getRoom(_rid: string) {
        return { id: roomId, regionId: roomId, tags: ["town_tier_1"] };
      },
    },
    characters: {
      async patchCharacter() {},
    },
  } as any;
}

test("[contract] quest show: npc-policy READY suggests handin when NPC is here", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const ctx = makeCtx(char, roomId);

  const quest: QuestDefinition = {
    id: "show_npc_handin_test",
    name: "Show NPC Handin Test",
    description: "Turn me in to a specific NPC.",
    turninPolicy: "npc",
    turninNpcId: "npc_quartermaster",
    objectives: [],
    reward: { xp: 5 },
  } as any;

  const state = ensureQuestState(char);
  state[quest.id] = {
    state: "completed",
    completions: 0,
    source: { kind: "service", service: "test", questId: quest.id, def: quest },
  } as any;

  // NPC not present: show should include a go-to hint and mention handin.
  (ctx.entities as any)._roomEnts = [];
  const notHere = renderQuestDetails(char, quest.id, { ctx });
  assert.match(notHere, /\[READY\]/);
  assert.match(notHere, /Eligible to turn in here: NO/);
  assert.match(notHere, /Go to npc_quartermaster\./);
  assert.match(notHere, /Then: handin npc_quartermaster/);

  // NPC present: show should recommend handin directly.
  (ctx.entities as any)._roomEnts = [
    { id: "ent_npc_1", type: "npc", roomId, protoId: "npc_quartermaster" },
  ];
  const here = renderQuestDetails(char, quest.id, { ctx });
  assert.match(here, /\[READY\]/);
  assert.match(here, /Eligible to turn in here: YES/);
  assert.match(here, /Turn in with: handin npc_quartermaster/);
  assert.match(here, /\(or: quest turnin show_npc_handin_test\)/);
});
