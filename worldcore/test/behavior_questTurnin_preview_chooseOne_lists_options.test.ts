// worldcore/test/behavior_questTurnin_preview_chooseOne_lists_options.test.ts
//
// Behavior: `quest turnin preview` should list choose-one reward options and hint the choose syntax.

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
    id: "char_test_turnin_preview_chooseone_1",
    userId: "user_test_chooseone_1",
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
    id: "ent_player_chooseone_1",
    type: "player",
    name: "Testy",
    roomId,
    x: 0,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    ownerSessionId: "sess_test_chooseone_1",
  } as any;

  return {
    session: {
      id: "sess_test_chooseone_1",
      identity: { userId: char.userId },
      character: char,
    },
    entities: {
      getEntityByOwner(sessId: string) {
        return sessId === selfEnt.ownerSessionId ? selfEnt : null;
      },
      getEntitiesInRoom(_rid: string) {
        return [] as any[];
      },
    },
    rooms: {
      getRoom(_rid: string) {
        return { id: roomId, regionId: roomId, tags: ["town_tier_1"] };
      },
    },
  } as any;
}

test("[behavior] quest turnin preview lists choose-one reward options + hint", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const ctx = makeCtx(char, roomId);

  const quest: QuestDefinition = {
    id: "policy_preview_chooseone_test",
    name: "Policy Preview ChooseOne Test",
    description: "Preview should list choose-one options.",
    objectives: [],
    reward: {
      xp: 1,
      chooseOne: [
        { label: "Power", xp: 5, items: [{ itemId: "debug_sword", count: 1 }] },
        { label: "Wisdom", gold: 2, titles: ["sage"] },
      ],
    },
  } as any;

  const state = ensureQuestState(char);
  state[quest.id] = {
    state: "completed",
    completions: 0,
    source: { kind: "service", service: "test", questId: quest.id, def: quest },
  } as any;

  const out = await turnInQuest(ctx, char, `preview ${quest.id}`);

  assert.match(out, /Reward choice: YES/i);
  assert.match(out, /\(1\)/);
  assert.match(out, /Power/);
  assert.match(out, /\(2\)/);
  assert.match(out, /Wisdom/);
  assert.match(out, /Use at turn-in: quest turnin .* choose <#>/i);
});
