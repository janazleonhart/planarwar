// worldcore/test/contract_quest_debug_caps_seam_key_v0_33.test.ts
//
// Contract (Quest Board v0.33): rotation history is seam-keyed by tuning regime,
// so changing presets/profiles doesn't cause old rotation memory to influence new regimes.

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
    id: "char_test_debug_caps_seam",
    userId: "user_test_debug_caps_seam",
    shardId: "prime_shard",

    name: "Quest Debug Caps Seam Tester",
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

function makeCtx(roomId: string, tags: string[]): AnyCtx {
  const session = { id: "sess_caps_seam_dev", roomId, auth: { isDev: true } };

  const playerEntity = {
    id: "player_ent_caps_seam",
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
            tags,
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

function extractRotationKey(out: string): string {
  const m = out.match(/rotationKey:\s*(.+)\s*$/im);
  assert.ok(m && m[1], `Expected rotationKey line in output; got:\n${out}`);
  return m[1].trim();
}

test("[contract] quest debug caps rotationKey differs across tuning presets (v0.33)", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_SEAM_KEY";

  try {
    const townId = "prime_shard:0,0";
    const char = makeChar();

    const ctxStrict = makeCtx(townId, ["starter", "town_tier_1", "town_tuning_strict"]);
    const outStrict = await handleQuestCommand(ctxStrict, char as any, cmd(["quest", "debug", "caps"]));
    const rkStrict = extractRotationKey(outStrict);

    const ctxLoose = makeCtx(townId, ["starter", "town_tier_1", "town_tuning_loose"]);
    const outLoose = await handleQuestCommand(ctxLoose, char as any, cmd(["quest", "debug", "caps"]));
    const rkLoose = extractRotationKey(outLoose);

    assert.notEqual(rkStrict, rkLoose, `Expected different rotationKey values across presets; strict=${rkStrict} loose=${rkLoose}`);
  } finally {
    process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
