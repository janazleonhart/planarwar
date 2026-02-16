// worldcore/test/contract_quest_board_followup_parent_rotation_memory.test.ts
//
// Contract (Quest chains v0.18):
// - When multiple parent quests unlock multiple follow-ups, the board should avoid
//   showing NEW follow-ups from the same parent chain on consecutive refreshes when
//   there are multiple chains available.
// - This is a soft preference (deprioritization), not a hard exclusion, and remains deterministic.

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest board deprioritizes recently-shown follow-up parent chains (parent rotation memory)", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch_parent_rot";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    const state = ensureQuestState(char as any);

    // Contract-only gate so these kit quests never appear in unrelated tests.
    state["__contract_only_followup_parent_rotation__"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    // Turn in three different parent quests, each unlocking 2 follow-ups.
    state["chain_followup_parent_rot_intro_a"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    state["chain_followup_parent_rot_intro_b"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    state["chain_followup_parent_rot_intro_c"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    // Seed rotation memory so parent A is considered "recently shown".
    const townId = roomId;
    const tier = 1;
    const epoch = process.env.PW_QUEST_EPOCH!;
    const rotationKey = `town:${townId}|t${tier}|followupParents`;

    (char as any).progression ??= {};
    (char as any).progression.questBoardHistory ??= {};
    (char as any).progression.questBoardHistory[rotationKey] = { epoch, ids: ["chain_followup_parent_rot_intro_a"] };

    const board = renderTownQuestBoard(ctx, char);

    // Tier 1 cap is 3 NEW follow-ups. With A marked recent, we expect B and C to appear.
    const b = board.match(/Parent Rot B[12]/g) ?? [];
    const c = board.match(/Parent Rot C[12]/g) ?? [];

    assert.ok(b.length >= 1, board);
    assert.ok(c.length >= 1, board);

    const total = (board.match(/Parent Rot [ABC][12]/g) ?? []).length;
    assert.strictEqual(total, 3, board);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_board_parent_rot_1", roomId, auth: { isDev: true } };

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
    userId: "user_board_parent_rot_1",
    id: "char_board_parent_rot_1",
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
