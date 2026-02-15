// worldcore/test/behavior_questTurnin_policy_npc.test.ts
//
// Behavior: turn-in policy 'npc' denies turn-in unless the specified NPC proto is present in the player's room.

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
import { turnInQuest } from "../quests/turnInQuest";

function makeChar(): CharacterState {
  return {
    id: "char_test_turnin_policy_npc_1",
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

  return {
    session: {
      id: "sess_test_1",
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
      async saveCharacter() {
        return;
      },
      async grantXp(_userId: string, _charId: string, amount: number) {
        char.xp += Math.max(0, Math.floor(amount));
        char.updatedAt = new Date();
        return char;
      },
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
  } as any;
}

test("[behavior] turnInQuest denies npc-policy quests unless NPC is present", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const ctx = makeCtx(char, roomId);

  const quest: QuestDefinition = {
    id: "policy_npc_test",
    name: "Policy NPC Test",
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
    source: {
      kind: "service",
      service: "test",
      questId: quest.id,
      def: quest,
    },
  } as any;

  // No NPC present in room -> denied.
  (ctx.entities as any)._roomEnts = [];
  const denied = await turnInQuest(ctx, char, quest.id);
  assert.ok(denied.includes("must turn this in") || denied.includes("Turn-in denied"), denied);

  // NPC present -> allowed.
  (ctx.entities as any)._roomEnts = [
    { id: "ent_npc_1", type: "npc", roomId, protoId: "npc_quartermaster" },
  ];

  const ok = await turnInQuest(ctx, char, quest.id);
  assert.ok(ok.includes("Turned in") || ok.includes("[quest]"), ok);
  assert.equal(char.xp, 5, "xp should be granted on successful turn-in");
});
