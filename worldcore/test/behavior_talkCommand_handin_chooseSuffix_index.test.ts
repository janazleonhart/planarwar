// worldcore/test/behavior_talkCommand_handin_chooseSuffix_index.test.ts
//
// Behavior: `talk <npc> handin <#> choose <#>` should treat the leading number as
// selection into the eligible NPC hand-in list and forward the choose suffix.

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
    id: "char_test_talk_handin_chooseSuffix_index_1",
    userId: "user_test_talk_handin_chooseSuffix_index_1",
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
    ownerSessionId: "sess_test_talk_handin_chooseSuffix_index_1",
  } as any;

  const npcEnt = {
    id: "ent_npc_1",
    type: "npc",
    name: "Quartermaster",
    roomId,
    protoId: "town_trainer",
    x: 1,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
  } as any;

  return {
    session: {
      id: selfEnt.ownerSessionId,
      roomId,
      identity: { userId: char.userId },
      character: char,
    },
    characters: {
      async grantXp(_userId: string, _charId: string, xp: number) {
        (char as any).xp = ((char as any).xp ?? 0) + Math.max(0, Math.floor(xp));
        return { xp: (char as any).xp, level: (char as any).level, attributes: (char as any).attributes };
      },
      async patchCharacter(_userId: string, _charId: string, patch: any) {
        for (const [k, v] of Object.entries(patch ?? {})) (char as any)[k] = v;
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
    rooms: {
      getRoom(_rid: string) {
        return { id: roomId, regionId: roomId, tags: ["town_tier_1"] };
      },
    },
  } as any;
}

test("[behavior] talk: supports eligible-index selection with choose suffix", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const ctx = makeCtx(char, roomId);

  const q1: QuestDefinition = {
    id: "policy_npc_talk_choose_index_a",
    name: "NPC Talk Eligible A",
    description: "First eligible NPC quest.",
    turninPolicy: "npc",
    turninNpcId: "town_trainer",
    objectives: [],
    reward: { xp: 1 },
  } as any;

  const q2: QuestDefinition = {
    id: "policy_npc_talk_choose_index_b",
    name: "NPC Talk Eligible B (Choice)",
    description: "Second eligible NPC quest, requires reward choice.",
    turninPolicy: "npc",
    turninNpcId: "town_trainer",
    objectives: [],
    reward: {
      chooseOne: [{ label: "XP", xp: 9 }],
    },
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

  const msg = await handleTalkCommand(ctx as any, char as any, {
    cmd: "talk",
    args: ["1", "handin", "2", "choose", "1"],
    parts: ["talk", "1", "handin", "2", "choose", "1"],
  });

  const s = String(msg);
  assert.ok(s.toLowerCase().includes("turned in") || s.toLowerCase().includes("turn in"), s);
  assert.equal(char.xp, 9, "xp should be granted from the chosen reward bundle");
});
