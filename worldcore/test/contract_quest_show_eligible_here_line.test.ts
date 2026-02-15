// worldcore/test/contract_quest_show_eligible_here_line.test.ts

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
import { renderQuestDetails } from "../quests/QuestText";

type AnyCtx = any;

function makeChar(): CharacterState {
  return {
    id: "char_test_quest_show_eligible_here",
    userId: "user_test_quest_show_eligible_here",
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

function makeCtx(roomId: string): AnyCtx {
  const session = { id: `sess_${roomId}`, roomId, auth: { isDev: true } };

  const playerEntity = {
    id: `player_${roomId}`,
    type: "player",
    ownerSessionId: session.id,
    roomId,
    x: 0,
    z: 0,
    name: "Player",
  };

  const entities = {
    getEntityByOwner: (sid: string) => (sid === session.id ? playerEntity : null),
    // For npc-policy quests this can be used by turn-in hinting; leave empty here.
    getEntitiesInRoom: (_rid: string) => [],
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
    patchCharacter: async () => {},
  };

  return { session, entities, rooms, characters } as AnyCtx;
}

test("[contract] quest show: READY details include Eligible-to-turn-in-here when ctx is provided", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH";

  try {
    const townA = "prime_shard:0,0";
    const townB = "prime_shard:9,9";

    const char = makeChar();
    const ctxA = makeCtx(townA);
    const ctxB = makeCtx(townB);

    const offering = generateTownQuests({
      townId: townA,
      tier: 1,
      epoch: "TEST_EPOCH",
      includeRepeatables: true,
    });

    assert.ok(offering.length > 0, "Expected at least one town quest offering.");

    const q0 = offering.find((q) => (q.objectives?.[0] as any)?.kind === "kill") ?? offering[0];
    assert.ok(q0 && q0.id, "Expected a quest offering with an id.");

    const acceptText = await acceptTownQuest(ctxA, char, q0.id);
    assert.match(acceptText, /Accepted:/);

    const qState = ensureQuestState(char) as any;
    assert.ok(qState[q0.id], "Expected quest state entry after accept.");

    // Satisfy objectives and mark READY.
    if ((q0.objectives?.[0] as any)?.kind === "kill") {
      (char.progression as any).kills = (char.progression as any).kills ?? {};
      const target = (q0.objectives?.[0] as any).targetProtoId;
      const required = Number((q0.objectives?.[0] as any).required ?? 1);
      (char.progression as any).kills[target] = required;
    }

    updateQuestsFromProgress(char);

    const readyInA = renderQuestDetails(char, q0.id, { ctx: ctxA });
    assert.match(readyInA, /\[READY\]/);
    assert.match(readyInA, /Eligible to turn in here: YES/);

    const readyInB = renderQuestDetails(char, q0.id, { ctx: ctxB });
    assert.match(readyInB, /\[READY\]/);
    assert.match(readyInB, /Eligible to turn in here: NO/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
