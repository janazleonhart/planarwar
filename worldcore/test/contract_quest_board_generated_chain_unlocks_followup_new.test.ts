// worldcore/test/contract_quest_board_generated_chain_unlocks_followup_new.test.ts
//
// Contract (Quest Generator v0.4):
// - Generated town quests may define `unlocks` (chain follow-ups).
// - Follow-ups are NOT part of the default generated offering until unlocked.
// - Once the prerequisite is turned in, the follow-up quest becomes discoverable on the board
//   and is marked [NEW].
//
// This ensures generated quest chains remain testable + discoverable without requiring the
// follow-up to be a registry quest.

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

import type { CharacterState } from "../characters/CharacterTypes";
import {
  defaultAbilities,
  defaultAttributes,
  defaultEquipment,
  defaultInventory,
  defaultProgression,
  defaultSpellbook,
} from "../characters/CharacterTypes";

type AnyCtx = any;

test("[contract] generated quest chain follow-up appears as [NEW] only after prerequisite is turned in", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch_generated_chain_v04";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    const parentId = "town_prime_shard_0_0_t1_rat_culling";
    const followId = "town_prime_shard_0_0_t1_rat_culling_ii";

    const before = renderTownQuestBoard(ctx, char);
    assert.ok(!/Rat Culling II/.test(before), before);

    // Turn in the prerequisite at least once.
    const qs = ensureQuestState(char as any);
    qs[parentId] = {
      state: "turned_in",
      completions: 1,
      source: {
        kind: "generated_town",
        townId: roomId,
        epoch: process.env.PW_QUEST_EPOCH,
        tier: 1,
      },
    } as any;

    const after = renderTownQuestBoard(ctx, char);
    assert.ok(/Rat Culling II/.test(after), after);
    assert.ok(/\[NEW\].*Rat Culling II/.test(after) || /Rat Culling II.*\[NEW\]/.test(after), after);

    // Follow-up should not already be in quest state (it is "discoverable", not auto-accepted).
    assert.ok(!qs[followId], "follow-up quest should not be auto-created in quest state");
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_generated_chain_unlock", roomId, auth: { isDev: true } };

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

function makeChar(): CharacterState {
  return {
    id: "char_generated_chain_unlock",
    userId: "user_generated_chain_unlock",
    shardId: "prime_shard",

    name: "Generated Chain Tester",
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
