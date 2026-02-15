// worldcore/test/contract_talkCommand_quests_board_accept.test.ts
//
// Contract:
// - talk <npc> quests shows the Town Quest Board in the talk flow
// - talk <npc> accept <#|id|name> accepts a town offering quest
// - tip text should recommend the talk-based accept path using either a nearby index
//   (e.g. "talk 1 accept") or a handle (e.g. "talk trainer.1 accept").

import assert from "node:assert/strict";
import test from "node:test";

import { ensureQuestState } from "../quests/QuestState";
import { handleTalkCommand } from "../mud/commands/world/talkCommand";

function makeChar(): any {
  return {
    id: "char_test_talk_board_1",
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

  const trainerEnt = {
    id: "ent_npc_trainer_1",
    type: "npc",
    name: "Town Trainer",
    roomId,
    protoId: "town_trainer",
    x: 1,
    y: 0,
    z: 0,
    hp: 120,
    maxHp: 120,
    alive: true,
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
      _roomEnts: [selfEnt, trainerEnt] as any[],
      getEntityByOwner(sessId: string) {
        return sessId === selfEnt.ownerSessionId ? selfEnt : null;
      },
      getEntitiesInRoom(_rid: string) {
        return (this as any)._roomEnts;
      },
    },
    rooms: {
      getRoom(rid: string) {
        if (String(rid) !== String(roomId)) return null;
        // Mark this room as a town tier 1 context so TownQuestBoard renders offerings.
        return {
          id: rid,
          regionId: rid,
          tags: ["starter", "town_tier_1"],
        } as any;
      },
    },
    npcs: {
      getNpcStateByEntityId(entityId: string) {
        if (entityId !== trainerEnt.id) return null;
        return {
          entityId: trainerEnt.id,
          protoId: trainerEnt.protoId,
          templateId: trainerEnt.protoId,
          roomId,
          hp: trainerEnt.hp,
          maxHp: trainerEnt.maxHp,
          alive: true,
        } as any;
      },
    },
  } as any;
}

test("[contract] talk quests shows board; talk accept accepts offering quest", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const char = makeChar();
    const ctx = makeCtx(char, roomId);

    // Nearby index 1 should resolve to the town trainer.
    const out = await handleTalkCommand(ctx as any, char as any, {
      cmd: "talk",
      args: ["1", "quests"],
      parts: ["talk", "1", "quests"],
    });

    const s = String(out);
    assert.ok(s.includes("You speak with Town Trainer"), s);
    assert.match(s, /Quest Board:/, s);

    // The hint can be "talk 1 accept" or "talk trainer.1 accept" depending on UX.
    assert.match(s, /Tip: accept via 'talk\s+(?:\d+|[a-z_]+\.\d+)\s+accept/i, s);

    // Accept the first offering via the handle (the UX-preferred path).
    const acceptOut = await handleTalkCommand(ctx as any, char as any, {
      cmd: "talk",
      args: ["trainer.1", "accept", "1"],
      parts: ["talk", "trainer.1", "accept", "1"],
    });

    const a = String(acceptOut);
    assert.match(a, /Accepted:/i, a);

    const state = ensureQuestState(char as any);
    assert.equal(Object.keys(state).length, 1);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
