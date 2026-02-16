// worldcore/test/contract_quest_board_available_filter_only_available.test.ts
//
// Contract:
// - `quest board available` (renderTownQuestBoard with { onlyAvailable: true }) shows only quests
//   that are available to accept: unaccepted AND non-NEW.
//   (Option A: NEW follow-ups are excluded; they have their own `quest board new` view.)
// - When none exist, it should show a friendly empty state.

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest board available shows only available (non-NEW) quests", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    // Baseline: should show at least one available quest.
    const baseline = renderTownQuestBoard(ctx, char, { onlyAvailable: true });
    assert.match(baseline, /Available quests:\s+\d+/, baseline);
    assert.match(baseline, /\[ \]/, baseline);

    // Unlock a follow-up so it would appear as NEW on the full board.
    const qs = ensureQuestState(char as any);
    qs["chain_intro_test"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    const afterUnlock = renderTownQuestBoard(ctx, char, { onlyAvailable: true });

    // NEW should be excluded in 'available' view.
    assert.ok(!/\[NEW\]/i.test(afterUnlock), afterUnlock);
    assert.ok(!/Chain Follow-up Test/i.test(afterUnlock), afterUnlock);

    // Still should show a regular available town quest.
    assert.match(afterUnlock, /Rat Culling/i, afterUnlock);

    // Now consume/transition the known stable town-offered quests so none are available.
    // (These IDs are used widely across existing quest-board contract tests.)
    qs["town_prime_shard_0_0_t1_rat_culling"] = {
      state: "active",
      completions: 0,
      source: { kind: "generated_town", townId: roomId, tier: 1 },
    } as any;

    qs["town_prime_shard_0_0_t1_greet_quartermaster"] = {
      state: "completed",
      completions: 0,
      source: { kind: "generated_town", townId: roomId, tier: 1 },
    } as any;

    qs["town_prime_shard_0_0_t1_rat_tail_collection"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "generated_town", townId: roomId, tier: 1 },
    } as any;

    const noneLeft = renderTownQuestBoard(ctx, char, { onlyAvailable: true });
    assert.match(noneLeft, /No available quests\./, noneLeft);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_board_available_filter_1", roomId, auth: { isDev: true } };

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
    userId: "user_board_available_filter_1",
    id: "char_board_available_filter_1",
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
