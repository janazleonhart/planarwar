// worldcore/test/contract_quest_debug_tuning_tier_overrides_v0_29.test.ts
//
// Contract (Quest Board v0.29): tier-based tuning overrides are visible via staff-only
// `quest debug tuning` and affect the *effective* knobs shown.

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
    id: "char_test_quest_debug_tuning_t3",
    userId: "user_test_quest_debug_tuning_t3",
    shardId: "prime_shard",

    name: "Quest Debug Tuning T3 Tester",
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
  const session = { id: `sess_tuning_t3_${isDev ? "dev" : "player"}`, roomId, auth: { isDev } };

  const playerEntity = {
    id: "player_ent_tuning_t3",
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
            tags: ["starter", "town_tier_3"],
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

test("[contract] quest debug tuning reflects tier-based overrides (v0.29)", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_DEBUG_TUNING_T3";

  try {
    const townId = "prime_shard:0,0";
    const char = makeChar();

    const ctxDev = makeCtx(townId, true);
    const out = await handleQuestCommand(ctxDev, char as any, cmd(["quest", "debug", "tuning"]));

    assert.match(out, /Quest Board Debug Tuning/i);
    assert.match(out, /overrides:/i);
    // Tier 3+ overrides (TownQuestBoard v0.29): 0.85 / 0.9
    assert.match(out, /avoidRecentUntilFrac:\s*0\.85/i);
    assert.match(out, /avoidRecentShapesUntilFrac:\s*0\.9/i);
  } finally {
    process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
