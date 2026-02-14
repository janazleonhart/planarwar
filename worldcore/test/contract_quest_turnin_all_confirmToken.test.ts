// worldcore/test/contract_quest_turnin_all_confirmToken.test.ts

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
    id: "char_test_turnin_all_1",
    userId: "user_test_turnin_all_1",
    shardId: "prime_shard",
    name: "Token Tester",
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
    id: "ent_player_turnin_all_1",
    type: "player",
    name: "Token Tester",
    roomId,
    x: 0,
    y: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    ownerSessionId: "sess_turnin_all_1",
  };
}

function makeCtx(char: CharacterState, self: Entity, roomId: string): any {
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
      return sessId === self.ownerSessionId ? self : null;
    },
  };

  const rooms = {
    getRoom(_rid: string) {
      return { id: roomId, regionId: roomId, tags: ["town_tier_1"] };
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

test("[contract] quest turnin all is confirm-token gated and turns in all completed quests", async () => {
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH";

  const roomId = "prime_shard:0,0";
  const char = makeChar();
  const self = makeSelfEntity(roomId);
  const ctx = makeCtx(char, self, roomId);

  const offering = generateTownQuests({
    townId: roomId,
    tier: 1,
    epoch: "TEST_EPOCH",
    includeRepeatables: true,
  });

  const talkQuest = offering.find((q) => q.objectives?.[0]?.kind === "talk_to");
  const killQuest = offering.find((q) => q.objectives?.[0]?.kind === "kill");

  assert.ok(talkQuest, "Expected a talk_to quest in the offering");
  assert.ok(killQuest, "Expected a kill quest in the offering");

  await acceptTownQuest(ctx, char, talkQuest!.id);
  await acceptTownQuest(ctx, char, killQuest!.id);

  // Satisfy objectives in progression so QuestEngine can complete them.
  const prog: any = (char as any).progression;
  prog.kills = prog.kills ?? {};
  prog.flags = prog.flags ?? {};

  const killObj: any = killQuest!.objectives?.[0];
  prog.kills[killObj.targetProtoId] = Number(killObj.required ?? 1);

  const talkObj: any = talkQuest!.objectives?.[0];
  prog.flags[`talked_to:${talkObj.npcId}`] = 1;

  updateQuestsFromProgress(char);

  const qState: any = ensureQuestState(char);
  assert.equal(qState[talkQuest!.id]?.state, "completed");
  assert.equal(qState[killQuest!.id]?.state, "completed");

  const preview = await turnInQuest(ctx, char, "all");
  assert.match(preview, /confirm with: quest turnin all/i);

  const m = preview.match(/quest turnin all\s+([a-f0-9]{16})/i);
  assert.ok(m, "Expected a 16-char hex confirm token in output");
  const token = m![1];

  const denied = await turnInQuest(ctx, char, "all deadbeefdeadbeef");
  assert.match(denied, /token mismatch/i);

  const xpBefore = (char as any).xp;
  const commit = await turnInQuest(ctx, char, `all ${token}`);
  assert.match(commit, /Turn-in ALL complete/i);

  const qState2: any = ensureQuestState(char);
  assert.equal(qState2[talkQuest!.id]?.state, "turned_in");
  assert.equal(qState2[killQuest!.id]?.state, "turned_in");
  assert.ok((char as any).xp >= xpBefore);
});
