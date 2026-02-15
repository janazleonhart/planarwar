// worldcore/test/behavior_handinCommand_npcTurnin.test.ts
//
// Behavior: `handin <npc>` provides an in-world NPC turn-in flow for quests that
// are configured with turninPolicy='npc' + turninNpcId.

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

import type { QuestDefinition } from "../quests/QuestTypes";
import { ensureQuestState } from "../quests/QuestState";
import { handleHandinCommand } from "../mud/commands/world/handinCommand";

function makeChar(): CharacterState {
  return {
    id: "char_test_handin_1",
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
  } as any;
}

function makeCtx(char: CharacterState, roomId: string) {
  const selfEnt = {
    id: "ent_player_1",
    type: "player",
    name: "Testy",
    roomId,
    x: 0,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    ownerSessionId: "sess_test_1",
  } as any;

  const npcEnt = {
    id: "ent_npc_1",
    type: "npc",
    name: "Quartermaster",
    roomId,
    protoId: "npc_quartermaster",
    x: 1,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
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
      async saveCharacter() {
        return;
      },
      async grantXp(_userId: string, _charId: string, amount: number) {
        char.xp += Math.max(0, Math.floor(amount));
        char.updatedAt = new Date();
        return char;
      },
    },
    entities: {
      _roomEnts: [selfEnt, npcEnt] as any[],
      getEntityByOwner(sessId: string) {
        return sessId === selfEnt.ownerSessionId ? selfEnt : null;
      },
      getEntitiesInRoom(_rid: string) {
        return (this as any)._roomEnts;
      },
    },
    rooms: {
      getRoom(_rid: string) {
        return { id: roomId, regionId: roomId, tags: ["town_tier_1"] };
      },
    },
  } as any;
}

test("[behavior] handin: turns in a completed npc-policy quest when the NPC is present", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const ctx = makeCtx(char, roomId);

  const quest: QuestDefinition = {
    id: "policy_npc_test_handin",
    name: "Policy NPC Test (Handin)",
    description: "Turn me in to a specific NPC via the handin command.",
    turninPolicy: "npc",
    turninNpcId: "npc_quartermaster",
    objectives: [],
    reward: { xp: 5 },
  } as any;

  const state = ensureQuestState(char);
  state[quest.id] = {
    state: "completed",
    completions: 0,
    source: {
      kind: "service",
      service: "test",
      questId: quest.id,
      def: quest,
    },
  } as any;

  // Use index "1" into nearby snapshot (the quartermaster is the only non-player in range).
  const msg = await handleHandinCommand(ctx as any, char as any, {
    cmd: "handin",
    args: ["1"],
    parts: ["handin", "1"],
  });

  assert.ok(String(msg).toLowerCase().includes("turn in"), String(msg));
  assert.equal(char.xp, 5, "xp should be granted on successful hand-in");
});
