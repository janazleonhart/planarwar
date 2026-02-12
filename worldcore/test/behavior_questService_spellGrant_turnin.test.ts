// worldcore/test/behavior_questService_spellGrant_turnin.test.ts

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

import type { Entity } from "../shared/Entity";

import { acceptTownQuest } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";
import { updateQuestsFromProgress } from "../quests/QuestEngine";
import { turnInQuest } from "../quests/turnInQuest";

function makeChar(): CharacterState {
  return {
    id: "char_test_quest_service_1",
    userId: "user_test_1",
    shardId: "prime_shard",

    name: "Testy McTestface",
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

function makeSelfEntity(roomId: string): Entity {
  return {
    id: "ent_player_1",
    type: "player",
    name: "Testy McTestface",
    roomId,
    x: 0,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    ownerSessionId: "sess_test_1",
  } as any;
}

function makeCtx(char: CharacterState, self: Entity, roomId: string): any {
  const characters = {
    async patchCharacter(_userId: string, _charId: string, patch: any) {
      for (const [k, v] of Object.entries(patch ?? {})) {
        (char as any)[k] = v;
      }
      char.updatedAt = new Date();
      return char;
    },
    async saveCharacter(_userId: string, _charId: string, _state: any) {
      return;
    },
    async grantXp(_userId: string, _charId: string, amount: number) {
      char.xp += Math.max(0, Math.floor(amount));
      char.updatedAt = new Date();
      return char;
    },
  };

  const entities = {
    getEntityByOwner(sessId: string) {
      return sessId === (self as any).ownerSessionId ? self : null;
    },
  };

  const rooms = {
    getRoom(_rid: string) {
      return {
        id: roomId,
        regionId: roomId,
        tags: ["town_tier_1"],
      };
    },
  };

  // Backing quest service (ex: PostgresQuestService) exposed via ctx.quests.
  const svcQuest = {
    id: "svc_spell_grant_test",
    name: "Service Spell Grant Test",
    description: "A quest provided by ctx.quests (not in registry).",
    objectives: [{ kind: "talk_to", npcId: "trainer_aria", required: 1 }],
    reward: {
      spellGrants: [{ spellId: "magician_summon_wolf_ii", source: "quest:svc_spell_grant_test" }],
      abilityGrants: [{ abilityId: "warrior_cleave", source: "quest:svc_spell_grant_test" }],
    },
    repeatable: false,
  } as any;

  const quests = {
    kind: "postgres",
    async getQuest(id: string) {
      return id === "svc_spell_grant_test" ? svcQuest : null;
    },
    async listQuests() {
      return [svcQuest];
    },
  };

  return {
    session: {
      id: (self as any).ownerSessionId,
      identity: { userId: char.userId },
      character: char,
    },
    characters,
    entities,
    rooms,
    quests,
  };
}

test("[behavior] quest service: accept by id, complete talk_to, turn-in grants pending spell + ability", async () => {
  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const self = makeSelfEntity(roomId);
  const ctx = makeCtx(char, self, roomId);

  const acceptText = await acceptTownQuest(ctx, char, "svc_spell_grant_test");
  assert.match(acceptText, /Accepted:/);

  const qState = ensureQuestState(char) as any;
  assert.equal(qState.svc_spell_grant_test?.state, "active");
  assert.equal(qState.svc_spell_grant_test?.source?.kind, "service");
  assert.equal(qState.svc_spell_grant_test?.source?.service, "postgres");

  // Satisfy talk_to objective.
  (char.progression as any).flags = (char.progression as any).flags ?? {};
  (char.progression as any).flags["talked_to:trainer_aria"] = true;

  updateQuestsFromProgress(char);

  const qState2 = ensureQuestState(char) as any;
  assert.equal(qState2.svc_spell_grant_test?.state, "completed");

  const out = await turnInQuest(ctx, char, "svc_spell_grant_test");
  assert.match(out, /You turn in/i);
  assert.match(out, /New spell granted/i);
  assert.match(out, /New ability granted/i);

  assert.ok((char.spellbook as any)?.pending?.magician_summon_wolf_ii);
  assert.ok((char.abilities as any)?.pending?.warrior_cleave);
});
