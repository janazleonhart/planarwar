// worldcore/test/contract_quest_board_followup_antispam_single_refresh.test.ts
//
// Contract (Quest chains v0.19):
// - When multiple parent quests unlock follow-ups, the board should avoid showing
//   multiple NEW follow-ups from the same parent when other parents have NEW follow-ups.
// - (Anti "repeat parent spam" within a single refresh. Deterministic.)

import test from "node:test";
import assert from "node:assert/strict";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

type AnyCtx = any;

test("[contract] quest board NEW follow-ups prefer one-per-parent within a single refresh (v0.19)", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch_v0_19";

  try {
    const roomId = "prime_shard:0,0";
    const ctx = makeCtx(roomId);
    const char = makeChar();

    const state = ensureQuestState(char as any);

    // Enable the contract-only follow-up parent kit.
    state["__contract_only_followup_parent_rotation__"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    // Turn in three different parent quests that unlock follow-ups.
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

    const out = renderTownQuestBoard(ctx, char);

    // Tier 1 NEW cap is 3. We should see exactly three Parent Rot follow-ups.
    const hits = out.match(/Parent Rot [ABC][12]/g) ?? [];
    assert.strictEqual(hits.length, 3, out);

    // And we should not show two from the same parent letter when all three parents have NEW follow-ups.
    const letters = hits.map((s) => (s.match(/Parent Rot ([ABC])/i)?.[1] ?? "?").toUpperCase());
    const set = new Set(letters);
    assert.strictEqual(set.size, 3, out);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});

function makeCtx(roomId: string): AnyCtx {
  const session = { id: "sess_board_v019_1", roomId, auth: { isDev: true } };

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
    userId: "user_board_v019_1",
    id: "char_board_v019_1",
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
