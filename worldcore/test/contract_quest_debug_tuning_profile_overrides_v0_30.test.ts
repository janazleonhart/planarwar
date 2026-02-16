// worldcore/test/contract_quest_debug_tuning_profile_overrides_v0_30.test.ts
//
// Contract (Quest Board v0.30): town profile tags can apply deterministic tuning nudges
// (staff-only via `quest debug tuning`). This should not affect player-facing text.

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
    id: "char_test_quest_debug_tuning_profile",
    userId: "user_test_quest_debug_tuning_profile",
    shardId: "prime_shard",

    name: "Quest Debug Tuning Profile Tester",
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
  const session = { id: `sess_tuning_profile_${isDev ? "dev" : "player"}`, roomId, auth: { isDev } };

  const playerEntity = {
    id: "player_ent_tuning_profile",
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
            tags: ["starter", "town_tier_3", "town_profile_arcane"],
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

test("[contract] quest debug tuning reflects profile-based overrides (v0.30)", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_DEBUG_TUNING_PROFILE";

  try {
    const townId = "prime_shard:0,0";
    const char = makeChar();

    const ctxDev = makeCtx(townId, true);
    const out = await handleQuestCommand(ctxDev, char as any, cmd(["quest", "debug", "tuning"]));

    assert.match(out, /Quest Board Debug Tuning/i);
    assert.match(out, /profileTags:/i);
    assert.match(out, /town_profile_arcane/i);
    assert.match(out, /profile:\s*arcane/i);

    // Tier 3+ base override is 0.9; arcane profile nudges shapes to 0.95.
    assert.match(out, /avoidRecentShapesUntilFrac:\s*0\.95/i);
  } finally {
    process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
