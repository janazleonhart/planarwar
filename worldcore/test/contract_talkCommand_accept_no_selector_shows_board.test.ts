// worldcore/test/contract_talkCommand_accept_no_selector_shows_board.test.ts
//
// Contract:
// - talk <npc> accept (with no selector) should show the Town Quest Board (context) + usage,
//   rather than only returning a bare usage error. This keeps the user in "talk mode".

import assert from "node:assert/strict";
import test from "node:test";

import { handleTalkCommand } from "../mud/commands/world/talkCommand";

function makeChar(): any {
  return {
    id: "char_test_talk_accept_nosel_1",
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

test("[contract] talk accept with no selector shows board + usage", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "test_epoch";

  try {
    const roomId = "prime_shard:0,0";
    const char = makeChar();
    const ctx = makeCtx(char, roomId);

    const out = await handleTalkCommand(ctx as any, char as any, {
      cmd: "talk",
      args: ["trainer.1", "accept"],
      parts: ["talk", "trainer.1", "accept"],
    });

    const s = String(out);
    assert.match(s, /You speak with Town Trainer/i, s);
    assert.match(s, /Quest Board:/i, s);
    assert.match(s, /Usage:\s+talk\s+trainer\.1\s+accept\s+<#/i, s);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
