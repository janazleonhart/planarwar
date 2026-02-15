// worldcore/test/behavior_questTurnin_policy_board.test.ts
//
// Behavior: turn-in policy 'board' denies turn-in unless the player is in a town-tier room
// (quest board context). Optionally, a specific board id can be required.

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
    id: "char_test_turnin_policy_board_1",
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

test("[behavior] turnInQuest denies board-policy quests unless in town-tier room", async () => {
  const char = makeChar();

  const quest: QuestDefinition = {
    id: "policy_board_test",
    name: "Policy Board Test",
    description: "Turn me in at the town quest board.",
    turninPolicy: "board",
    turninBoardId: "town_alpha",
    objectives: [],
    reward: { xp: 7 },
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

  // Not in a town-tier room -> denied.
  {
    const ctx = makeCtx(char, "prime_shard:0,0", "town_alpha", []);
    const denied = await turnInQuest(ctx, char, quest.id);
    assert.ok(
      denied.includes("quest board") || denied.includes("quest board context") || denied.includes("Turn-in denied"),
      denied
    );
  }

  // In a town-tier room but wrong board -> denied.
  {
    const ctx = makeCtx(char, "prime_shard:0,0", "town_beta", ["town_tier_1"]);
    const denied = await turnInQuest(ctx, char, quest.id);
    assert.ok(denied.includes("Required:") || denied.includes("must return"), denied);
  }

  // In the correct town-tier room -> allowed.
  {
    const ctx = makeCtx(char, "prime_shard:0,0", "town_alpha", ["town_tier_1"]);
    const ok = await turnInQuest(ctx, char, quest.id);
    assert.ok(ok.includes("Turned in") || ok.includes("[quest]"), ok);
    assert.equal(char.xp, 7, "xp should be granted on successful turn-in");
  }
});
