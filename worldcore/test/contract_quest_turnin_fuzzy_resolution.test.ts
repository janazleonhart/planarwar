// worldcore/test/contract_quest_turnin_fuzzy_resolution.test.ts

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

import { acceptTownQuest } from "../quests/TownQuestBoard";
import { ensureQuestState } from "../quests/QuestState";
import { updateQuestsFromProgress } from "../quests/QuestEngine";
import { generateTownQuests } from "../quests/QuestGenerator";
import { turnInQuest } from "../quests/turnInQuest";

type AnyCtx = any;

function makeChar(): CharacterState {
  return {
    id: "char_test_quest_turnin_fuzzy",
    userId: "user_test_quest_turnin_fuzzy",
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

function makeCtx(roomId: string, char: CharacterState): AnyCtx {
  const session = { id: "sess_test_quest_turnin_fuzzy", roomId, auth: { isDev: true }, character: char };

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
    listEntitiesInRoom: (_rid: string) => [],
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
    patchCharacter: async () => char,
  };

  return { session, entities, rooms, characters } as AnyCtx;
}

test("[contract] quest turnin: supports fuzzy resolution by partial quest name", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH";

  try {
    const roomId = "prime_shard:0,0";
    const char = makeChar();
    const ctx = makeCtx(roomId, char);

    const offering = generateTownQuests({
      townId: roomId,
      tier: 1,
      epoch: "TEST_EPOCH",
      includeRepeatables: true,
    });

    assert.ok(offering.length > 0, "Expected at least one town quest offering.");

    // Prefer a kill quest so we can deterministically satisfy objectives for READY rendering.
    const q0 = offering.find((q) => (q.objectives?.[0] as any)?.kind === "kill") ?? offering[0];
    assert.ok(q0 && q0.id, "Expected a quest offering with an id.");

    const acceptText = await acceptTownQuest(ctx, char, q0.id);
    assert.match(acceptText, /Accepted:/);

    const qState = ensureQuestState(char) as any;
    assert.ok(qState[q0.id], "Expected quest state entry after accept.");

    // Satisfy kill objective and mark quest completed
    if ((q0.objectives?.[0] as any)?.kind === "kill") {
      (char.progression as any).kills = (char.progression as any).kills ?? {};
      const target = (q0.objectives?.[0] as any).targetProtoId;
      const required = Number((q0.objectives?.[0] as any).required ?? 1);
      (char.progression as any).kills[target] = required;
    }

    updateQuestsFromProgress(char);
    assert.equal((qState[q0.id] as any).state, "completed");

    const partial = q0.name.slice(0, Math.min(6, q0.name.length)).trim();
    const msg = await turnInQuest(ctx, char, partial);

    assert.match(msg, /\[quest\] You turn in '/);
    assert.equal((qState[q0.id] as any).state, "turned_in");
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
