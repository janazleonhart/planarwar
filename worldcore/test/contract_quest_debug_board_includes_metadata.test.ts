// worldcore/test/contract_quest_debug_board_includes_metadata.test.ts
//
// Contract (Quest Board v0.24): staff-only debug board view includes deterministic
// per-quest metadata (objective signature + semantic keys) to help internal QA.

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

import { generateTownQuests } from "../quests/QuestGenerator";
import { handleQuestCommand } from "../mud/commands/progression/questsCommand";

type AnyCtx = any;

function makeChar(): CharacterState {
  return {
    id: "char_test_quest_debug_board",
    userId: "user_test_quest_debug_board",
    shardId: "prime_shard",

    name: "Quest Debug Board Tester",
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
  const session = { id: `sess_debug_${isDev ? "dev" : "player"}`, roomId, auth: { isDev } };

  const playerEntity = {
    id: "player_ent",
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

test("[contract] quest debug board is staff-only", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_DEBUG_BOARD";

  try {
    const townId = "prime_shard:0,0";
    const char = makeChar();

    // Force generation at least once (ensures board exists in ctx).
    generateTownQuests({ townId, tier: 1, epoch: "TEST_EPOCH_DEBUG_BOARD", includeRepeatables: true });

    const ctxPlayer = makeCtx(townId, false);
    const denied = await handleQuestCommand(ctxPlayer, char as any, cmd(["quest", "debug", "board"]));
    assert.match(denied, /staff-only/i);

    const ctxDev = makeCtx(townId, true);
    const out = await handleQuestCommand(ctxDev, char as any, cmd(["quest", "debug", "board"]));

    // Expect at least one debug metadata line.
    assert.match(out, /\{\s+sig=/i);
    assert.match(out, /sem=/i);
  } finally {
    process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
