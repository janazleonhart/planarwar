// worldcore/test/contract_quest_board_header_counts_new.test.ts
//
// Contract:
// - Quest board header includes counts and NEW count.
// - NEW count reflects unlocked follow-up quests not yet accepted.
// - In `onlyNew` mode, header shows NEW quests available count.

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest board header shows counts + NEW and updates on unlock/accept", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    // Before unlock: NEW should be 0, and onlyNew mode should show 0.
    const before = renderTownQuestBoard(ctx, char);
    assert.match(before, /Quests available:\s+\d+\s+\(NEW:\s+0\)/);

    const beforeNew = renderTownQuestBoard(ctx, char, { onlyNew: true });
    assert.match(beforeNew, /NEW quests available:\s+0/);

    // Unlock follow-up by marking intro quest as turned in once.
    const state = ensureQuestState(char as any);
    state["chain_intro_test"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    const afterUnlock = renderTownQuestBoard(ctx, char);
    assert.match(afterUnlock, /Quests available:\s+\d+\s+\(NEW:\s+1\)/);

    const afterUnlockNew = renderTownQuestBoard(ctx, char, { onlyNew: true });
    assert.match(afterUnlockNew, /NEW quests available:\s+1/);

    // After accepting the follow-up, it is no longer NEW.
    state["chain_followup_test"] = {
      state: "active",
      completions: 0,
      source: { kind: "registry" },
    } as any;

    const afterAccept = renderTownQuestBoard(ctx, char);
    assert.match(afterAccept, /\(NEW:\s+0\)/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_board_header_1", roomId, auth: { isDev: true } };

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
    userId: "user_board_header_1",
    id: "char_board_header_1",
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
