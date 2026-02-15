// worldcore/test/contract_quest_board_unlocked_followups_marked_new.test.ts
//
// Contract:
// - Unlocked follow-up quests (from another quest's `unlocks`) should be visually
//   marked as NEW on the town quest board when they first become available.
// - The NEW marker should only appear for quests not yet accepted.

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest board marks unlocked follow-up quests as NEW", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    // Before unlock: should not list the follow-up at all.
    const before = renderTownQuestBoard(ctx, char);
    assert.ok(!/Chain Follow-up Test/.test(before), before);
    assert.ok(!/\[NEW\]/.test(before), before);

    // Unlock follow-up by marking intro quest as turned in once.
    const state = ensureQuestState(char as any);
    state["chain_intro_test"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    const after = renderTownQuestBoard(ctx, char);
    // Follow-up should be listed and marked NEW.
    assert.match(after, /\[NEW\]\s+Chain Follow-up Test/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_chain_board_new_1", roomId, auth: { isDev: true } };

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

function makeChar(): any {
  return {
    userId: "user_chain_board_new_1",
    id: "char_chain_board_new_1",
    shardId: "prime_shard",
    name: "Testy",
    classId: "warrior",
    raceId: "human",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    progression: {},
    inventory: [],
    bags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
