// worldcore/test/behavior_questV0_loop_spellKill_turnin.test.ts

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

import { performNpcAttack } from "../mud/actions/MudCombatActions";
import { acceptTownQuest, resolveQuestDefinitionFromStateId } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";
import { turnInQuest } from "../quests/turnInQuest";
import { updateQuestsFromProgress } from "../quests/QuestEngine";
import { generateTownQuests } from "../quests/QuestGenerator";

function makeChar(): CharacterState {
  return {
    id: "char_test_1",
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
  };
}

function makeRatEntity(roomId: string, idx: number): Entity {
  return {
    id: `ent_rat_${idx}`,
    type: "npc",
    // Quest target is protoId "town_rat"; kill fallback uses npc.name when ctx.npcs is absent.
    name: "town_rat",
    roomId,
    x: 1,
    y: 0,
    z: 0,
    hp: 1,
    maxHp: 1,
    alive: true,
  };
}

function makeCtx(char: CharacterState, self: Entity, roomId: string): any {
  const characters = {
    async patchCharacter(_userId: string, _charId: string, patch: any) {
      if (patch?.progression) char.progression = patch.progression;
      if (patch?.inventory) char.inventory = patch.inventory;
      if (typeof patch?.xp === "number") char.xp = patch.xp;
      if (typeof patch?.level === "number") char.level = patch.level;
      if (patch?.updatedAt) char.updatedAt = patch.updatedAt;
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
      return sessId === self.ownerSessionId ? self : null;
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

  return {
    session: {
      id: self.ownerSessionId,
      identity: { userId: char.userId },
      character: char,
    },
    characters,
    entities,
    rooms,
  };
}

test("[behavior] quest v0 loop: accept -> spell kill -> complete -> turn-in", async () => {
  // Freeze epoch so generated quest ids + required counts are stable over time.
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH";

  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const self = makeSelfEntity(roomId);
  const ctx = makeCtx(char, self, roomId);

  // IMPORTANT:
  // Index 1 on the quest board is ALWAYS the "greet quartermaster" talk_to quest.
  // The kill quest can appear at a different index depending on deterministic shuffling,
  // so we accept the rat-culling quest by id (derived from the same generator inputs).
  const offering = generateTownQuests({
    townId: roomId,
    tier: 1,
    epoch: "TEST_EPOCH",
    includeRepeatables: true,
  });

  const ratQuest = offering.find(
    (q) =>
      q.objectives?.[0]?.kind === "kill" &&
      (q.objectives?.[0] as any).targetProtoId === "town_rat"
  );

  assert.ok(ratQuest, "Expected a generated rat-culling kill quest in the town offering.");

  const acceptText = await acceptTownQuest(ctx, char, ratQuest.id);
  assert.match(acceptText, /Accepted:/);

  const questId = ratQuest.id;

  const entry = (char.progression as any)?.quests?.[questId];
  const qDef = resolveQuestDefinitionFromStateId(questId, entry);
  assert.ok(qDef, `Quest definition should resolve for id=${questId}`);
  assert.equal(qDef!.objectives?.[0]?.kind, "kill");
  assert.equal((qDef!.objectives?.[0] as any).targetProtoId, "town_rat");

  const required = Number((qDef!.objectives?.[0] as any).required ?? 1);
  assert.ok(Number.isFinite(required) && required >= 1);

  for (let i = 0; i < required; i++) {
    const rat = makeRatEntity(roomId, i + 1);
    const out = await performNpcAttack(ctx, char, self, rat, {
      channel: "spell",
      spellSchool: "arcane" as any,
      abilityName: "Arcane Bolt",
      tagPrefix: "spell",
      damageMultiplier: 999,
    } as any);

    assert.match(out, /You slay/);
  }

  // Ensure the quest engine evaluates the now-updated progression counters.
  updateQuestsFromProgress(char);

  const qState = ensureQuestState(char) as any;
  assert.equal(qState[questId]?.state, "completed");

  const xpBefore = char.xp;
  const turnInText = await turnInQuest(ctx, char, questId);
  assert.match(turnInText, /You turn in/i);

  const qState2 = ensureQuestState(char) as any;
  assert.equal(qState2[questId]?.state, "turned_in");
  assert.equal(qState2[questId]?.completions, 1);

  const rewardXp = Number((qDef!.reward as any)?.xp ?? 0);
  assert.equal(char.xp, xpBefore + rewardXp);
});
