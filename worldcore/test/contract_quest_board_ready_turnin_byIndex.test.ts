// worldcore/test/contract_quest_board_ready_turnin_byIndex.test.ts
//
// Contract:
// - `quest board ready turnin <#>` resolves the numeric index against the *board ready view*
//   (not the quest log ordering), then delegates to the canonical turn-in implementation.
// - This is pure UX sugar: it should behave like `quest turnin <id>` but with board indices.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import {
  defaultAbilities,
  defaultAttributes,
  defaultEquipment,
  defaultInventory,
  defaultProgression,
  defaultSpellbook,
} from "../characters/CharacterTypes";

import { ensureQuestState } from "../quests/QuestState";
import { handleQuestCommand } from "../mud/commands/progression/questsCommand";

type AnyCtx = any;

function makeChar(): CharacterState {
  return {
    id: "char_test_board_ready_turnin_idx",
    userId: "user_test_board_ready_turnin_idx",
    shardId: "prime_shard",

    name: "Board Ready Turnin Tester",
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

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_test_board_ready_turnin_idx", roomId, auth: { isDev: true } };

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
    grantXp: async () => null,
  };

  return { session, entities, rooms, characters } as AnyCtx;
}

function cmd(parts: string[]) {
  return { cmd: "quest", args: parts.slice(1), parts };
}

test("[contract] quest board ready turnin 1 turns in the ready quest shown at index 1", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_BOARD_READY_TURNIN";

  try {
    const townId = "prime_shard:0,0";
    const ctx = makeCtx(townId);
    const char = makeChar();

    // Satisfy the deterministic rat-culling objective (safety re-check occurs at turn-in).
    (char as any).progression.kills["town_rat"] = 999;

    // Mark a known deterministic town quest as completed and bound to this town.
    const qs = ensureQuestState(char as any);
    qs["town_prime_shard_0_0_t1_rat_culling"] = {
      state: "completed",
      completions: 0,
      source: {
        kind: "generated_town",
        townId,
        epoch: process.env.PW_QUEST_EPOCH,
        tier: 1,
      },
    } as any;

    const out = await handleQuestCommand(ctx, char as any, cmd(["quest", "board", "ready", "turnin", "1"]));

    // We don't assert exact text (it may evolve), but it must succeed.
    assert.ok(!/denied/i.test(out), out);
    assert.equal(qs["town_prime_shard_0_0_t1_rat_culling"].state, "turned_in");
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
