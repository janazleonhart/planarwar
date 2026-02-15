// worldcore/test/behavior_questTurnin_preview_policy_hint.test.ts
//
// Behavior: `quest turnin preview` reports whether the quest can be turned in "here"
// when a quest uses turn-in policies (npc/board).

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
    id: "char_test_turnin_preview_policy_1",
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

test("[behavior] quest turnin preview includes policy-based eligibility + hint", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const ctx = makeCtx(char, roomId);

  const quest: QuestDefinition = {
    id: "policy_preview_test",
    name: "Policy Preview Test",
    description: "Preview should explain if I can turn in here.",
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

  // No NPC present -> preview should report NO and include hint.
  (ctx.entities as any)._roomEnts = [];
  const deniedPreview = await turnInQuest(ctx, char, `preview ${quest.id}`);
  assert.match(deniedPreview, /Can turn in here: NO/);
  assert.match(deniedPreview, /Turn-in hint:/);

  // NPC present -> preview should report YES.
  (ctx.entities as any)._roomEnts = [
    { id: "ent_npc_1", type: "npc", roomId, protoId: "npc_quartermaster" },
  ];
  const okPreview = await turnInQuest(ctx, char, `preview ${quest.id}`);
  assert.match(okPreview, /Can turn in here: YES/);

  // Anywhere policy should always report YES (and no hint).
  const anywhereQuest: QuestDefinition = {
    id: "policy_preview_anywhere_test",
    name: "Policy Preview Anywhere Test",
    description: "Anywhere policy should always be eligible.",
    objectives: [],
    reward: { xp: 1 },
  } as any;

  state[anywhereQuest.id] = {
    state: "completed",
    completions: 0,
    source: { kind: "service", service: "test", questId: anywhereQuest.id, def: anywhereQuest },
  } as any;

  const anywherePreview = await turnInQuest(ctx, char, `preview ${anywhereQuest.id}`);
  assert.match(anywherePreview, /Can turn in here: YES/);
  assert.doesNotMatch(anywherePreview, /Turn-in hint:/);
});
