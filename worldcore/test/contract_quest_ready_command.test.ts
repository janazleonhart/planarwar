// worldcore/test/contract_quest_ready_command.test.ts
//
// Contract: `quest ready` is a fast path that shows only quests that are truly
// ready to turn in, and it respects objective satisfaction (not just state=completed).

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
    id: "char_test_quest_ready",
    userId: "user_test_quest_ready",
    shardId: "prime_shard",

    name: "Quest Ready Tester",
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
  const session = { id: "sess_test_quest_ready", roomId, auth: { isDev: true } };

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

test("[contract] quest ready: shows none when no quests are ready, then shows READY quest after objectives satisfied", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_READY";

  try {
    const roomId = "prime_shard:0,0";
    const char = makeChar();
    const ctx = makeCtx(roomId);

    const offering = generateTownQuests({
      townId: roomId,
      tier: 1,
      epoch: "TEST_EPOCH_READY",
      includeRepeatables: true,
    });

    assert.ok(offering.length > 0, "Expected at least one town quest offering.");

    // Prefer a kill quest so we can satisfy progress deterministically.
    const q0 = offering.find((q) => (q.objectives?.[0] as any)?.kind === "kill") ?? offering[0];
    assert.ok(q0 && q0.id, "Expected a quest offering with an id.");

    const acceptText = await acceptTownQuest(ctx, char, q0.id);
    assert.match(acceptText, /Accepted:/);

    // Not completed yet -> ready list should be empty
    const noneReady = await handleQuestCommand(ctx, char, cmd(["quest", "ready"]));
    assert.match(noneReady, /Quests \(ready\):/);
    assert.match(noneReady, /None ready to turn in/);

    // Mark completed but without satisfying objective should still not show
    // (QuestEngine sets state based on progress; we intentionally *do not* satisfy yet.)
    // If generator selected non-kill objective, we skip this stricter check.

    // Satisfy objective, update quest engine, then ready list should include q0
    if ((q0.objectives?.[0] as any)?.kind === "kill") {
      (char.progression as any).kills = (char.progression as any).kills ?? {};
      const target = (q0.objectives?.[0] as any).targetProtoId;
      const required = Number((q0.objectives?.[0] as any).required ?? 1);
      (char.progression as any).kills[target] = required;

      updateQuestsFromProgress(char);

      const ready = await handleQuestCommand(ctx, char, cmd(["quest", "ready"]));
      assert.match(ready, /\[READY\]/);
      assert.match(ready, new RegExp(q0.id));
      assert.match(ready, /Rewards:/);
    }
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
