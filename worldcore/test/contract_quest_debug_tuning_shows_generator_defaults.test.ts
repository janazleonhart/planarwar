// worldcore/test/contract_quest_debug_tuning_shows_generator_defaults.test.ts
//
// Contract (Quest Board v0.28): staff-only debug tuning shows the effective generator
// default knobs for the current town context.

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

type AnyCtx = any;

function makeChar(): CharacterState {
  return {
    id: "char_test_quest_debug_tuning",
    userId: "user_test_quest_debug_tuning",
    shardId: "prime_shard",

    name: "Quest Debug Tuning Tester",
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
  const session = { id: `sess_tuning_${isDev ? "dev" : "player"}`, roomId, auth: { isDev } };

  const playerEntity = {
    id: "player_ent_tuning",
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

test("[contract] quest debug tuning is staff-only and shows generator defaults", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_DEBUG_TUNING";

  try {
    const townId = "prime_shard:0,0";
    const char = makeChar();

    const ctxPlayer = makeCtx(townId, false);
    const denied = await handleQuestCommand(ctxPlayer, char as any, cmd(["quest", "debug", "tuning"]));
    assert.match(denied, /staff-only/i);

    const ctxDev = makeCtx(townId, true);
    const out = await handleQuestCommand(ctxDev, char as any, cmd(["quest", "debug", "tuning"]));
    assert.match(out, /Quest Board Debug Tuning/i);
    assert.match(out, /kindBaseCap:/i);
    assert.match(out, /avoidRecentShapesUntilFrac:/i);
  } finally {
    process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
