// worldcore/test/contract_talkCommand_npcHandinHints.test.ts
//
// Contract: talking to an NPC should surface eligible NPC-policy quest hand-ins
// with the `handin <npcHandle>` UX.

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
    id: "char_test_talk_handin_1",
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

test("[contract] talk: suggests handin handle when NPC-policy quest is eligible", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const ctx = makeCtx(char, roomId);

  const quest: QuestDefinition = {
    id: "policy_npc_test_talk_handin",
    name: "Policy NPC Test (Talk Handin)",
    description: "Talking should suggest the handin flow when eligible.",
    turninPolicy: "npc",
    turninNpcId: "training_dummy",
    objectives: [],
    reward: { xp: 5 },
  } as any;

  const state = ensureQuestState(char);
  state[quest.id] = {
    state: "completed",
    completions: 0,
    source: {
      kind: "service",
      service: "test",
      questId: quest.id,
      def: quest,
    },
  } as any;

  // Use index "1" into nearby snapshot (the dummy is the only non-player in range).
  const msg = await handleTalkCommand(ctx as any, char as any, {
    cmd: "talk",
    args: ["1"],
    parts: ["talk", "1"],
  });

  const s = String(msg);
  assert.ok(s.includes("You speak with Training Dummy"), s);
  assert.ok(s.includes("handin"), s);
  // training dummy => handle base is "dummy.1".
  assert.ok(s.includes("handin dummy.1"), s);
});
