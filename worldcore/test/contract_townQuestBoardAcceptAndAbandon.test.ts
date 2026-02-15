// worldcore/test/contract_townQuestBoardAcceptAndAbandon.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard, acceptTownQuest, abandonQuest } from "../quests/TownQuestBoard";
import { renderQuestLog } from "../quests/QuestText";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] town quest board accept adds quest to questlog", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";

    const ctx = makeCtx(roomId);
    const char = makeChar();

    const board = renderTownQuestBoard(ctx, char);
    assert.match(board, /Quest Board:/);
    assert.match(board, /Report to the Quartermaster/);

    const acceptMsg = await acceptTownQuest(ctx, char, "1");
    assert.match(acceptMsg, /Accepted:/);

    const state = ensureQuestState(char);
    assert.equal(Object.keys(state).length, 1);

    const log = renderQuestLog(char);
    assert.match(log, /\[A\]/);
    assert.match(log, /Report to the Quartermaster/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});


test("[contract] quest accept supports partial name match when unambiguous", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";

    const ctx = makeCtx(roomId);
    const char = makeChar();

    const acceptMsg = await acceptTownQuest(ctx, char, "Quartermaster");
    assert.match(acceptMsg, /Accepted:/);

    const log = renderQuestLog(char);
    assert.match(log, /Report to the Quartermaster/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});


test("[contract] quest abandon removes quest from questlog", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";

    const ctx = makeCtx(roomId);
    const char = makeChar();

    await acceptTownQuest(ctx, char, "1");

    const state = ensureQuestState(char);
    const ids = Object.keys(state);
    assert.equal(ids.length, 1);

    const abandonMsg = await abandonQuest(ctx, char, ids[0]);
    assert.match(abandonMsg, /Abandoned/);

    const after = renderQuestLog(char);
    assert.match(after, /None accepted/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

test("[contract] quest abandon supports partial name match when unambiguous", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";

    const ctx = makeCtx(roomId);
    const char = makeChar();

    await acceptTownQuest(ctx, char, "1");

    const abandonMsg = await abandonQuest(ctx, char, "Quartermaster");
    assert.match(abandonMsg, /Abandoned/);

    const after = renderQuestLog(char);
    assert.match(after, /None accepted/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

test("[contract] quest abandon supports numeric questlog index even when not in matching town", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const ctxTown = makeCtx("prime_shard:0,0");
    const char = makeChar();

    await acceptTownQuest(ctxTown, char, "1");

    // Move the player to a different town context so the board offering differs.
    const ctxOtherTown = makeCtx("prime_shard:9,9");

    const abandonMsg = await abandonQuest(ctxOtherTown, char, "1");
    assert.match(abandonMsg, /Abandoned/);

    const after = renderQuestLog(char);
    assert.match(after, /None accepted/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess1", roomId, auth: { isDev: true } };

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

  // Used by TownQuestBoard.persistQuestState
  const characters = {
    patchCharacter: async () => {},
  };

  return { session, entities, rooms, characters } as AnyCtx;
}

function makeChar(): any {
  return {
    userId: "user1",
    id: "char1",
    progression: {},
    inventory: [],
    bags: [],
  };
}
