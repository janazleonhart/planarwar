// worldcore/test/contract_talkCommand_turnin_alias.test.ts
//
// Contract:
//  - talk <npc> turnin should behave like talk <npc> handin for NPC-policy turn-ins.
//  - In particular, `talk <npc> turnin list` should list eligible quests and not turn them in.

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
    id: "char_test_talk_turnin_alias_1",
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

test("[contract] talk: turnin list aliases handin list", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const ctx = makeCtx(char, roomId);

  const q1: QuestDefinition = {
    id: "policy_npc_test_talk_turnin_alias_1",
    name: "Policy NPC Turnin Alias Test",
    description: "Eligible quest for list via turnin alias.",
    turninPolicy: "npc",
    turninNpcId: "training_dummy",
    objectives: [],
    reward: { xp: 1 },
  } as any;

  const state = ensureQuestState(char);
  state[q1.id] = {
    state: "completed",
    completions: 0,
    source: { kind: "service", service: "test", questId: q1.id, def: q1 },
  } as any;

  const msg = await handleTalkCommand(ctx as any, char as any, {
    cmd: "talk",
    args: ["1", "turnin", "list"],
    parts: ["talk", "1", "turnin", "list"],
  });

  const s = String(msg);
  assert.ok(/can accept a quest hand-in/i.test(s), s);
  assert.ok(s.includes(q1.id), s);

  // Must not have turned it in.
  assert.equal(ensureQuestState(char)[q1.id]?.state, "completed");
  assert.ok(!/You turn in/i.test(s), s);
});
