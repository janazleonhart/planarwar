// worldcore/test/contract_talkCommand_npcHandin_select_and_all_token.test.ts
//
// Contract:
//  - talk <npc> handin <#> should turn in the selected eligible NPC-policy quest.
//  - talk <npc> handin all should return a confirm token.
//  - talk <npc> handin all <token> should turn in all eligible NPC-policy quests.

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

import { handleTalkCommand } from "../mud/commands/world/talkCommand";

function makeChar(): CharacterState {
  return {
    id: "char_test_talk_handin_all_1",
    userId: "user_test_1",
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
    ownerSessionId: "sess_test_1",
  } as any;

  const npcEnt = {
    id: "ent_npc_1",
    type: "npc",
    name: "Training Dummy",
    roomId,
    protoId: "training_dummy",
    x: 1,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
  } as any;

  return {
    session: {
      id: "sess_test_1",
      roomId,
      identity: { userId: char.userId },
      character: char,
    },
    characters: {
      async grantXp(_userId: string, _charId: string, xp: number) {
        (char as any).xp = ((char as any).xp ?? 0) + xp;
        return { xp: (char as any).xp, level: (char as any).level, attributes: (char as any).attributes };
      },
      async patchCharacter(_userId: string, _charId: string, patch: any) {
        for (const [k, v] of Object.entries(patch ?? {})) {
          (char as any)[k] = v;
        }
        char.updatedAt = new Date();
        return char;
      },
    },
    entities: {
      _roomEnts: [selfEnt, npcEnt] as any[],
      getEntityByOwner(sessId: string) {
        return sessId === selfEnt.ownerSessionId ? selfEnt : null;
      },
      getEntitiesInRoom(_rid: string) {
        return (this as any)._roomEnts;
      },
    },
    npcs: {
      getNpcStateByEntityId(entityId: string) {
        if (entityId !== npcEnt.id) return null;
        return {
          entityId: npcEnt.id,
          protoId: npcEnt.protoId,
          templateId: npcEnt.protoId,
          roomId,
          hp: npcEnt.hp,
          maxHp: npcEnt.maxHp,
          alive: true,
        };
      },
    },
  } as any;
}

test("[contract] talk: handin <#> selects eligible NPC-policy quest; handin all is token gated", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const ctx = makeCtx(char, roomId);

  const q1: QuestDefinition = {
    id: "policy_npc_test_talk_handin_1",
    name: "Policy NPC Test One",
    description: "First eligible quest.",
    turninPolicy: "npc",
    turninNpcId: "training_dummy",
    objectives: [],
    reward: { xp: 1 },
  } as any;

  const q2: QuestDefinition = {
    id: "policy_npc_test_talk_handin_2",
    name: "Policy NPC Test Two",
    description: "Second eligible quest.",
    turninPolicy: "npc",
    turninNpcId: "training_dummy",
    objectives: [],
    reward: { xp: 2 },
  } as any;

  const state = ensureQuestState(char);
  state[q1.id] = {
    state: "completed",
    completions: 0,
    source: { kind: "service", service: "test", questId: q1.id, def: q1 },
  } as any;
  state[q2.id] = {
    state: "completed",
    completions: 0,
    source: { kind: "service", service: "test", questId: q2.id, def: q2 },
  } as any;

  // Selection: pick #2.
  const msgPick = await handleTalkCommand(ctx as any, char as any, {
    cmd: "talk",
    args: ["1", "handin", "2"],
    parts: ["talk", "1", "handin", "2"],
  });
  assert.ok(String(msgPick).includes("You turn in"), String(msgPick));
  assert.equal(ensureQuestState(char)[q2.id]?.state, "turned_in");
  assert.equal(ensureQuestState(char)[q1.id]?.state, "completed");

  // Token request for "all" should NOT immediately complete the remaining one.
  const msgAll = await handleTalkCommand(ctx as any, char as any, {
    cmd: "talk",
    args: ["1", "handin", "all"],
    parts: ["talk", "1", "handin", "all"],
  });
  const sAll = String(msgAll);
  assert.ok(sAll.includes("confirm-token"), sAll);
  assert.equal(ensureQuestState(char)[q1.id]?.state, "completed");

  const m = sAll.match(/talk\s+[^\s]+\s+handin\s+all\s+([0-9a-f]{16})/i);
  assert.ok(m && m[1], sAll);
  const token = m![1];

  // Now confirm and execute.
  const msgConfirm = await handleTalkCommand(ctx as any, char as any, {
    cmd: "talk",
    args: ["1", "handin", "all", token],
    parts: ["talk", "1", "handin", "all", token],
  });
  const sConfirm = String(msgConfirm);
  assert.ok(sConfirm.includes("Hand in ALL complete"), sConfirm);
  assert.equal(ensureQuestState(char)[q1.id]?.state, "turned_in");
});
