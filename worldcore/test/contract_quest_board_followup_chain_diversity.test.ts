// worldcore/test/contract_quest_board_followup_chain_diversity.test.ts
//
// Contract (Quest chains v0.17):
// - When multiple turned-in quests unlock multiple follow-ups at once, the board should spread
//   NEW follow-ups across different parent chains first (within the existing NEW cap).
// - This prevents the board from showing three follow-ups from the same chain while another
//   chain is entirely hidden.

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest board spreads NEW follow-ups across different parent chains (chain diversity)", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch_diverse";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    const state = ensureQuestState(char as any);

    // Contract-only gate so these kit quests never appear in unrelated tests.
    state["__contract_only_chain_diversity__"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    // Turn in two different parent quests, each unlocking 3 follow-ups.
    state["chain_followup_diverse_intro_a"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    state["chain_followup_diverse_intro_b"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    const board = renderTownQuestBoard(ctx, char);

    // Tier 1 cap is 3 NEW follow-ups. We expect at least one from A and one from B.
    const a = board.match(/Chain Diverse A[123]/g) ?? [];
    const b = board.match(/Chain Diverse B[123]/g) ?? [];

    assert.ok(a.length >= 1, board);
    assert.ok(b.length >= 1, board);

    // Still respecting the overall cap: no more than 3 diverse follow-ups should be visible.
    const total = (board.match(/Chain Diverse [AB][123]/g) ?? []).length;
    assert.strictEqual(total, 3, board);

    const newTags = board.match(/\[NEW\]/g) ?? [];
    assert.ok(newTags.length >= 3, board);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_board_diverse_1", roomId, auth: { isDev: true } };

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
    userId: "user_board_diverse_1",
    id: "char_board_diverse_1",
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
