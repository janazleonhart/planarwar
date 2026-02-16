// worldcore/test/contract_quest_accept_index_matches_board_order.test.ts
//
// Contract:
// - Numeric indices for accepting town quests must match the *rendered* quest board ordering
//   (NEW-first + status-grouped), not the raw offering array order.

import test from "node:test";
import assert from "node:assert/strict";

import { acceptTownQuest, renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest accept <#> uses quest board ordering (NEW-first)", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    // Unlock follow-up by marking intro quest as turned in once.
    const state = ensureQuestState(char as any);
    state["chain_intro_test"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    const board = renderTownQuestBoard(ctx, char);
    const firstEntryLine = board.split("\n").find((l) => /^\s*\d+\./.test(l));
    assert.ok(firstEntryLine, board);
    assert.match(firstEntryLine!, /\[NEW\]\s+Chain Follow-up Test/, board);

    // Accept by index: must accept the NEW follow-up shown at #1.
    const out = await acceptTownQuest(ctx, char as any, "1");
    assert.match(out, /Accepted:/, out);

    const after = ensureQuestState(char as any);
    assert.equal(after["chain_followup_test"]?.state, "active");
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_accept_board_idx_1", roomId, auth: { isDev: true } };

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
    userId: "user_accept_board_idx_1",
    id: "char_accept_board_idx_1",
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
