// worldcore/test/contract_quest_board_sort_status_groups.test.ts
//
// Contract:
// - Quest board ordering is deterministic and groups quests as:
//     1) NEW unlocked follow-ups (not accepted)
//     2) Active [A]
//     3) Completed [C]
//     4) Turned in [T]
//     5) Available [ ]
// - Ordering within each group is stable.

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest board groups by NEW then status (A/C/T/available)", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    // Set up: unlock a follow-up quest so it appears as NEW.
    const qs = ensureQuestState(char as any);
    qs["chain_intro_test"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    // Ensure we have examples of each status among the town-offered quests.
    // These are stable generator IDs used widely in other contracts.
    qs["town_prime_shard_0_0_t1_rat_culling"] = {
      state: "active",
      completions: 0,
      source: { kind: "generated_town", townId: "prime_shard:0,0", tier: 1 },
    } as any;

    qs["town_prime_shard_0_0_t1_greet_quartermaster"] = {
      state: "completed",
      completions: 0,
      source: { kind: "generated_town", townId: "prime_shard:0,0", tier: 1 },
    } as any;

    qs["town_prime_shard_0_0_t1_rat_tail_collection"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "generated_town", townId: "prime_shard:0,0", tier: 1 },
    } as any;

    const out = renderTownQuestBoard(ctx, char);

    // Must contain each marker at least once.
    assert.match(out, /\[NEW\]/, out);
    assert.match(out, /\[A\]/, out);
    assert.match(out, /\[C\]/, out);
    assert.match(out, /\[T\]/, out);

    // Ordering: NEW line appears before [A], which appears before [C], which appears before [T].
    const idxNew = out.indexOf("[NEW]");
    const idxA = out.indexOf("[A]");
    const idxC = out.indexOf("[C]");
    const idxT = out.indexOf("[T]");

    assert.ok(idxNew >= 0 && idxA >= 0 && idxC >= 0 && idxT >= 0, out);
    assert.ok(idxNew < idxA, out);
    assert.ok(idxA < idxC, out);
    assert.ok(idxC < idxT, out);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_board_sort_groups_1", roomId, auth: { isDev: true } };

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
    userId: "user_board_sort_groups_1",
    id: "char_board_sort_groups_1",
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
