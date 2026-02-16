// worldcore/test/contract_quest_debug_explain_includes_rotation_markers.test.ts
//
// Contract (Quest Generator v0.27): staff-only `quest debug explain` shows
// rotation-memory comparisons (signature/family/id) for internal verification.

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
    id: "char_test_quest_debug_explain",
    userId: "user_test_quest_debug_explain",
    shardId: "prime_shard",

    name: "Quest Debug Explain Tester",
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
  const session = { id: `sess_explain_${isDev ? "dev" : "player"}`, roomId, auth: { isDev } };

  const playerEntity = {
    id: "player_ent_explain",
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

test("[contract] quest debug explain shows rotation markers (staff-only)", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_DEBUG_EXPLAIN";

  try {
    const townId = "prime_shard:0,0";
    const char = makeChar();

    const ctxPlayer = makeCtx(townId, false);
    const denied = await handleQuestCommand(ctxPlayer, char as any, cmd(["quest", "debug", "explain", "1"]));
    assert.match(denied, /staff-only/i);

    const ctxDev = makeCtx(townId, true);

    // Accept a deterministic board entry so we have an accepted quest to explain.
    await acceptTownQuest(ctxDev, char as any, "1");

    const out = await handleQuestCommand(ctxDev, char as any, cmd(["quest", "debug", "explain", "1"]));
    assert.match(out, /Debug \(staff\):/i);
    assert.match(out, /signature:/i);
    assert.match(out, /families:/i);
    assert.match(out, /explain:/i);
    assert.match(out, /rotationKey:/i);
    assert.match(out, /epoch:\s*TEST_EPOCH_DEBUG_EXPLAIN/i);
  } finally {
    process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
