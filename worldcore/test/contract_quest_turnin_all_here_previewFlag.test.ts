// worldcore/test/contract_quest_turnin_all_here_previewFlag.test.ts

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
import { generateTownQuests } from "../quests/QuestGenerator";
import { turnInQuest } from "../quests/turnInQuest";

function makeChar(): CharacterState {
  return {
    id: "char_test_turnin_all_here_preview_1",
    userId: "user_test_turnin_all_here_preview_1",
    shardId: "prime_shard",
    name: "Here Preview Tester",
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
    id: "ent_player_turnin_all_here_preview_1",
    type: "player",
    name: "Here Preview Tester",
    roomId,
    x: 0,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    ownerSessionId: "sess_turnin_all_here_preview_1",
  };
}

function makeCtx(char: CharacterState, self: Entity, currentRoomIdRef: { roomId: string }): any {
  const characters = {
    async patchCharacter(_userId: string, _charId: string, patch: any) {
      if (patch?.progression) char.progression = patch.progression;
      if (patch?.inventory) char.inventory = patch.inventory;
      if (patch?.spellbook) (char as any).spellbook = patch.spellbook;
      if (patch?.abilities) (char as any).abilities = patch.abilities;
      return char;
    },
    async grantXp(_userId: string, _charId: string, amount: number) {
      char.xp += Math.max(0, Math.floor(amount));
      return char;
    },
  };

  const entities = {
    getEntityByOwner(sessId: string) {
      return sessId === self.ownerSessionId ? { ...self, roomId: currentRoomIdRef.roomId } : null;
    },
  };

  const rooms = {
    getRoom(rid: string) {
      return { id: rid, regionId: rid, tags: ["town_tier_1"] };
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

test("[contract] quest turnin all here --preview lists eligible quests but does not emit a confirm token", async () => {
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH";

  const townA = "prime_shard:0,0";
  const townB = "prime_shard:1,0";
  const char = makeChar();

  const current = { roomId: townA };
  const self = makeSelfEntity(townA);
  const ctx = makeCtx(char, self, current);

  const offeringA = generateTownQuests({
    townId: townA,
    tier: 1,
    epoch: "TEST_EPOCH",
    includeRepeatables: true,
  });
  const offeringB = generateTownQuests({
    townId: townB,
    tier: 1,
    epoch: "TEST_EPOCH",
    includeRepeatables: true,
  });

  const killQuestA = offeringA.find((q) => q.objectives?.[0]?.kind === "kill");
  const killQuestB = offeringB.find((q) => q.objectives?.[0]?.kind === "kill");

  assert.ok(killQuestA, "Expected a kill quest in offeringA");
  assert.ok(killQuestB, "Expected a kill quest in offeringB");

  current.roomId = townA;
  await acceptTownQuest(ctx, char, killQuestA!.id);

  current.roomId = townB;
  await acceptTownQuest(ctx, char, killQuestB!.id);

  // Satisfy objectives.
  const prog: any = (char as any).progression;
  prog.kills = prog.kills ?? {};

  const objA: any = killQuestA!.objectives?.[0];
  const objB: any = killQuestB!.objectives?.[0];
  prog.kills[objA.targetProtoId] = Number(objA.required ?? 1);
  prog.kills[objB.targetProtoId] = Number(objB.required ?? 1);

  updateQuestsFromProgress(char);

  const qState: any = ensureQuestState(char);
  assert.equal(qState[killQuestA!.id]?.state, "completed");
  assert.equal(qState[killQuestB!.id]?.state, "completed");

  // In townA, only questA is eligible for a board turn-in.
  current.roomId = townA;

  const preview = await turnInQuest(ctx, char, "all here --preview");
  assert.match(preview, /Turn-in ALL ready quests \(here\):/);
  assert.match(preview, new RegExp(killQuestA!.id));
  assert.doesNotMatch(preview, new RegExp(killQuestB!.id));

  // No token in preview output.
  assert.doesNotMatch(preview, /confirm with:/i);
  assert.doesNotMatch(preview, /quest turnin all here\s+[a-f0-9]{16}/i);
});
