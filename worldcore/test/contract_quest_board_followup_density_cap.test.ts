// worldcore/test/contract_quest_board_followup_density_cap.test.ts
//
// Contract (Quest chains v0.16):
// - If a quest unlocks many follow-ups at once, the board should not flood the list with NEW quests.
// - Instead, it should surface a small deterministic subset of unaccepted follow-ups, while always
//   surfacing any follow-ups that have already been accepted (active/completed/turned in).

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest board staggers many unlocked follow-ups (density cap) but never hides accepted follow-ups", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    const state = ensureQuestState(char as any);

    // Unlock many follow-ups.
    state["chain_intro_multi_test"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    const afterUnlock = renderTownQuestBoard(ctx, char);

    // Tier 1 cap should show only 3 NEW follow-ups at a time.
    const names = afterUnlock.match(/Chain Follow-up Multi [A-E]/g) ?? [];
    assert.strictEqual(names.length, 3, afterUnlock);

    const newTags = afterUnlock.match(/\[NEW\]/g) ?? [];
    assert.ok(newTags.length >= 3, afterUnlock);

    // Even if an accepted follow-up was not in the surfaced subset, it must appear once accepted.
    state["chain_followup_multi_a"] = {
      state: "active",
      completions: 0,
      source: { kind: "registry" },
    } as any;

    const afterAccept = renderTownQuestBoard(ctx, char);
    assert.match(afterAccept, /Chain Follow-up Multi A/);

    // Still capped for the remaining unaccepted follow-ups.
    const afterNames = afterAccept.match(/Chain Follow-up Multi [A-E]/g) ?? [];
    assert.ok(afterNames.length >= 3 && afterNames.length <= 4, afterAccept);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_board_density_1", roomId, auth: { isDev: true } };

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
    userId: "user_board_density_1",
    id: "char_board_density_1",
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
