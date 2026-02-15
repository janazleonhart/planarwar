// worldcore/test/contract_quest_prereq_gating_accept.test.ts
//
// Contract:
// - A quest with requiresTurnedIn cannot be accepted until its prerequisite quest is turned in.
// - Once the prerequisite is turned in, the follow-up quest can be accepted.

import assert from "node:assert/strict";
import test from "node:test";

import { acceptTownQuest } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";

function makeChar(): any {
  return {
    id: "char_test_prereq_accept_1",
    userId: "user_test_1",
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

function makeCtx(char: any, roomId: string) {
  const selfEnt = {
    id: "ent_player_1",
    type: "player",
    name: char.name,
    roomId,
    x: 0,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    ownerSessionId: "sess_test_1",
  } as any;

  return {
    session: {
      id: "sess_test_1",
      roomId,
      identity: { userId: char.userId },
      character: char,
    },
    characters: {
      async patchCharacter(_userId: string, _charId: string, patch: any) {
        for (const [k, v] of Object.entries(patch ?? {})) {
          (char as any)[k] = v;
        }
        char.updatedAt = new Date();
        return char;
      },
    },
    entities: {
      getEntityByOwner(sessId: string) {
        return sessId === selfEnt.ownerSessionId ? selfEnt : null;
      },
      getEntitiesInRoom(_rid: string) {
        return [selfEnt];
      },
    },
    rooms: {
      getRoom(rid: string) {
        if (String(rid) !== String(roomId)) return null;
        return {
          id: rid,
          regionId: rid,
          tags: ["town_tier_1"],
        } as any;
      },
    },
  } as any;
}

test("[contract] quest accept denies prereq-locked quests until prereq is turned in", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const char = makeChar();
    const ctx = makeCtx(char, roomId);

    // Follow-up is locked until chain_intro_test has been turned in.
    const denied = await acceptTownQuest(ctx as any, char as any, "chain_followup_test");
    assert.match(String(denied), /Cannot accept.*requires you to turn in/i, String(denied));

    // Simulate turning in the prerequisite.
    const state = ensureQuestState(char as any);
    state["chain_intro_test"] = {
      state: "turned_in",
      completions: 1,
      source: { kind: "registry" },
    } as any;

    const ok = await acceptTownQuest(ctx as any, char as any, "chain_followup_test");
    assert.match(String(ok), /Accepted:/i, String(ok));
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
