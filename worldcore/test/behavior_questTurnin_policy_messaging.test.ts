// worldcore/test/behavior_questTurnin_policy_messaging.test.ts
//
// Behavior: turn-in policy denial messages should be actionable (tell the player what to do next).
// v0.2: the wording can change, but the guidance should remain present.

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
import { acceptTownQuest } from "../quests/TownQuestBoard";
import { turnInQuest } from "../quests/turnInQuest";

function makeChar(): CharacterState {
  return {
    id: "char_test_turnin_policy_msg_1",
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

function makeCtx(char: CharacterState, roomId: string, regionId: string, tags: string[]) {
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
      getEntityByOwner(sessId: string) {
        return sessId === selfEnt.ownerSessionId ? selfEnt : null;
      },
      getEntitiesInRoom(_rid: string) {
        return [];
      },
    },
    rooms: {
      getRoom(_rid: string) {
        return { id: roomId, regionId, tags };
      },
    },
  } as any;
}

test("[behavior] npc-policy denial message includes handin + talk guidance", async () => {
  const char = makeChar();

  const quest: QuestDefinition = {
    id: "policy_msg_npc",
    name: "Policy Msg NPC",
    description: "Turn me in to an NPC.",
    turninPolicy: "npc",
    turninNpcId: "trainer_aria",
    objectives: [],
    reward: { xp: 1 },
  } as any;

  const state = ensureQuestState(char);
  state[quest.id] = {
    state: "completed",
    completions: 0,
    source: { kind: "service", service: "test", questId: quest.id, def: quest },
  } as any;

  const ctx = makeCtx(char, "prime_shard:0,0", "town_alpha", ["town_tier_1"]);
  const denied = await turnInQuest(ctx, char, quest.id);

  assert.ok(denied.toLowerCase().includes("handin"), denied);
  assert.ok(denied.toLowerCase().includes("talk"), denied);
  assert.ok(denied.includes("trainer_aria"), denied);
});

test("[behavior] board-policy denial message mentions accepted-town binding for generated quests", async () => {
  const char = makeChar();

  // Accept a deterministic generated town quest in town_alpha.
  const ctxAccepted = makeCtx(char, "prime_shard:0,0", "town_alpha", ["town_tier_1"]);
  await acceptTownQuest(ctxAccepted, char, "1");

  const state = ensureQuestState(char);
  const acceptedQuestId = Object.keys(state)[0];
  assert.ok(acceptedQuestId, "expected a generated quest to be accepted");

  // Mark it as READY.
  state[acceptedQuestId] = {
    ...(state[acceptedQuestId] as any),
    state: "completed",
    completions: 0,
  } as any;

  // Try to turn in from the wrong town.
  const ctxWrongTown = makeCtx(char, "prime_shard:0,0", "town_beta", ["town_tier_1"]);
  const denied = await turnInQuest(ctxWrongTown, char, acceptedQuestId);

  assert.ok(denied.toLowerCase().includes("accepted"), denied);
  assert.ok(denied.includes("town_alpha"), denied);
});
