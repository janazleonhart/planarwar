// worldcore/test/contract_quest_board_active_filter_only_active.test.ts
//
// Contract:
// - `quest board active` (renderTownQuestBoard with { onlyActive: true }) shows only quests
//   that are currently active (accepted but not completed).
// - When none exist, it should show a friendly empty state.

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest board active shows only active quests", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    const before = renderTownQuestBoard(ctx, char, { onlyActive: true });
    assert.match(before, /No active quests\./, before);

    // Mark a known deterministic town quest as active.
    const state = ensureQuestState(char as any);
    state["town_prime_shard_0_0_t1_rat_culling"] = {
      state: "active",
      completions: 0,
      source: {
        kind: "generated",
        townId: "prime_shard:0,0",
        epoch: "test_epoch",
        tier: 1,
      },
    } as any;

    const after = renderTownQuestBoard(ctx, char, { onlyActive: true });
    assert.match(after, /Active quests:\s+1/, after);
    assert.match(after, /\[A\].*Rat Culling/i, after);

    // Should not show the other offered quests.
    assert.ok(!/Rat Tail Collection/i.test(after), after);
    assert.ok(!/Report to the Quartermaster/i.test(after), after);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_board_active_filter_1", roomId, auth: { isDev: true } };

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
    userId: "user_board_active_filter_1",
    id: "char_board_active_filter_1",
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
