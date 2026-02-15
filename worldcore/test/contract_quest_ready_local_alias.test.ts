// worldcore/test/contract_quest_ready_local_alias.test.ts
//
// Contract: `quest ready local` and `quest readylocal` behave like `quest ready here`.

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
import { updateQuestsFromProgress } from "../quests/QuestEngine";
import { generateTownQuests } from "../quests/QuestGenerator";
import { handleQuestCommand } from "../mud/commands/progression/questsCommand";

type AnyCtx = any;

function makeChar(): CharacterState {
  return {
    id: "char_test_quest_ready_local",
    userId: "user_test_quest_ready_local",
    shardId: "prime_shard",

    name: "Quest ReadyLocal Tester",
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
  const session = { id: "sess_test_quest_ready_local", roomId, auth: { isDev: true } };

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
    getEntitiesInRoom: (rid: string) => (rid === roomId ? [playerEntity] : []),
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

function cmd(parts: string[]) {
  return { cmd: "quest", args: parts.slice(1), parts };
}

test("[contract] quest ready local/readylocal: aliases of ready here", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_READY_LOCAL";

  try {
    const townA = "prime_shard:0,0";
    const townB = "prime_shard:9,9";

    const char = makeChar();

    // Accept a generated town quest in townA.
    const ctxA = makeCtx(townA);
    const offering = generateTownQuests({
      townId: townA,
      tier: 1,
      epoch: "TEST_EPOCH_READY_LOCAL",
      includeRepeatables: true,
    });

    assert.ok(offering.length > 0, "Expected at least one town quest offering.");

    const q0 = offering.find((q) => (q.objectives?.[0] as any)?.kind === "kill") ?? offering[0];
    assert.ok(q0 && q0.id, "Expected a quest offering with an id.");

    const acceptText = await acceptTownQuest(ctxA, char, q0.id);
    assert.match(acceptText, /Accepted:/);

    // Satisfy objective so it is READY.
    if ((q0.objectives?.[0] as any)?.kind === "kill") {
      (char.progression as any).kills = (char.progression as any).kills ?? {};
      const target = (q0.objectives?.[0] as any).targetProtoId;
      const required = Number((q0.objectives?.[0] as any).required ?? 1);
      (char.progression as any).kills[target] = required;
      updateQuestsFromProgress(char);
    }

    // In townA: both aliases should include it.
    const localA = await handleQuestCommand(ctxA, char, cmd(["quest", "ready", "local"]));
    assert.match(localA, /Quests \(ready here\):/);
    assert.match(localA, /\[READY\]/);

    const readylocalA = await handleQuestCommand(ctxA, char, cmd(["quest", "readylocal"]));
    assert.match(readylocalA, /Quests \(ready here\):/);
    assert.match(readylocalA, /\[READY\]/);

    // In townB: both aliases should exclude it.
    const ctxB = makeCtx(townB);
    const localB = await handleQuestCommand(ctxB, char, cmd(["quest", "ready", "local"]));
    assert.match(localB, /Quests \(ready here\):/);
    assert.match(localB, /None ready to turn in here/);

    const readylocalB = await handleQuestCommand(ctxB, char, cmd(["quest", "readylocal"]));
    assert.match(readylocalB, /Quests \(ready here\):/);
    assert.match(readylocalB, /None ready to turn in here/);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
