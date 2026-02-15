// worldcore/test/contract_questText_talkto_humanizesNpcId.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import type { CharacterState } from "../characters/CharacterTypes";
import {
  defaultAbilities,
  defaultAttributes,
  defaultEquipment,
  defaultInventory,
  defaultProgression,
  defaultSpellbook,
} from "../characters/CharacterTypes";

import { renderTownQuestBoard } from "../quests/TownQuestBoard";

function makeChar(roomId: string): CharacterState {
  return {
    id: "char_test_qtext_talkto_1",
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

    lastRegionId: null,
    appearanceTag: null,

    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    abilities: defaultAbilities(),
    spellbook: defaultSpellbook(),
    progression: defaultProgression(),

    createdAt: new Date(),
    updatedAt: new Date(),

    // Many quest helpers prefer roomId via session/room context, but keep it here too.
    roomId,
  } as any;
}

function makeCtx(char: CharacterState, roomId: string): any {
  return {
    session: {
      id: "sess_test_1",
      roomId,
      identity: { userId: char.userId },
      character: char,
    },
    rooms: {
      getRoom(_rid: string) {
        return {
          id: roomId,
          regionId: roomId,
          tags: ["town_tier_1"],
        };
      },
    },
  };
}

test("[contract] quest text: talk_to objective renders human-friendly npc label", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar(roomId);
  const ctx = makeCtx(char, roomId);

  const out = renderTownQuestBoard(ctx, char as any);

  // The greet quest uses npc_quartermaster in the objective pool.
  // We want a nicer label, but still keep the proto id for clarity.
  assert.match(out, /Talk to Quartermaster \(npc_quartermaster\)/i);
});
