// worldcore/test/contract_quest_debug_caps_shows_rotation_memory.test.ts
//
// Contract (Quest Board v0.25): staff-only debug caps view exposes rotation memory keys
// to validate fairness + anti-spam behavior without touching player UX.

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

import { handleQuestCommand } from "../mud/commands/progression/questsCommand";
import { acceptTownQuest } from "../quests/TownQuestBoard";

type AnyCtx = any;

function makeChar(): CharacterState {
  return {
    id: "char_test_quest_debug_caps",
    userId: "user_test_quest_debug_caps",
    shardId: "prime_shard",

    name: "Quest Debug Caps Tester",
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

function makeCtx(roomId: string, isDev: boolean): AnyCtx {
  const session = { id: `sess_caps_${isDev ? "dev" : "player"}`, roomId, auth: { isDev } };

  const playerEntity = {
    id: "player_ent_caps",
    type: "player",
    ownerSessionId: session.id,
    roomId,
    x: 0,
    z: 0,
    name: "Player",
  };

  const entities = {
    getEntityByOwner: (sid: string) => (sid === session.id ? playerEntity : null),
    getEntitiesInRoom: (rid: string) => (rid === roomId ? [playerEntity] : []),
  };

  const rooms = {
    getRoom: (rid: string) =>
      rid === roomId
        ? {
            id: rid,
            regionId: rid,
            tags: ["starter", "town_tier_1"],
          }
        : null,
  };

  const characters = {
    patchCharacter: async () => {},
  };

  return { session, entities, rooms, characters } as AnyCtx;
}

function cmd(parts: string[]) {
  return { cmd: "quest", args: parts.slice(1), parts };
}

test("[contract] quest debug caps is staff-only and shows rotation key + memory", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_DEBUG_CAPS";

  try {
    const townId = "prime_shard:0,0";
    const char = makeChar();

    const ctxPlayer = makeCtx(townId, false);
    const denied = await handleQuestCommand(ctxPlayer, char as any, cmd(["quest", "debug", "caps"]));
    assert.match(denied, /staff-only/i);

    const ctxDev = makeCtx(townId, true);

    // Touch the board so rotation memory has something to show.
    // (Accepting by index forces the board view to resolve deterministically.)
    await acceptTownQuest(ctxDev, char as any, "1");

    const out = await handleQuestCommand(ctxDev, char as any, cmd(["quest", "debug", "caps"]));
    assert.match(out, /rotationKey:\s*town:/i);
    assert.match(out, /recentOfferedIds:/i);
    assert.match(out, /epoch:\s*TEST_EPOCH_DEBUG_CAPS/i);
  } finally {
    process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
