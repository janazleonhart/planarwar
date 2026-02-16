// worldcore/test/contract_quest_board_ready_preview_byIndex.test.ts
//
// Contract:
// - `quest board ready preview <#>` resolves the numeric index against the *board ready view*
//   (not quest-log ordering), and delegates to the canonical `quest turnin preview <id>` path.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import {
  defaultAbilities,
  defaultAttributes,
  defaultEquipment,
  defaultInventory,
  defaultProgression,
  defaultSpellbook,
} from "../characters/CharacterTypes";

import { ensureQuestState } from "../quests/QuestState";
import { handleQuestCommand } from "../mud/commands/progression/questsCommand";

type AnyCtx = any;

function makeChar(): CharacterState {
  return {
    id: "char_test_board_ready_preview_idx",
    userId: "user_test_board_ready_preview_idx",
    shardId: "prime_shard",
    name: "Board Ready Preview Tester",
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
  const session = { id: "sess_test_board_ready_preview_idx", roomId, auth: { isDev: true } };

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
    grantXp: async () => null,
  };

  return { session, entities, rooms, characters } as AnyCtx;
}

function cmd(parts: string[]) {
  return { cmd: "quest", args: parts.slice(1), parts };
}

test("[contract] quest board ready preview 1 previews the ready quest shown at index 1", async () => {
  const prevEpoch = process.env.PW_QUEST_EPOCH;
  process.env.PW_QUEST_EPOCH = "TEST_EPOCH_BOARD_READY_PREVIEW";

  try {
    const townId = "prime_shard:0,0";
    const ctx = makeCtx(townId);
    const char = makeChar();

    // Objective safety re-check exists even for preview, so satisfy it deterministically.
    (char as any).progression.kills["town_rat"] = 999;

    const qs = ensureQuestState(char as any);
    qs["town_prime_shard_0_0_t1_rat_culling"] = {
      state: "completed",
      completions: 0,
      source: {
        kind: "generated_town",
        townId,
        epoch: process.env.PW_QUEST_EPOCH,
        tier: 1,
      },
    } as any;

    const out = await handleQuestCommand(ctx, char as any, cmd(["quest", "board", "ready", "preview", "1"]));
    const s = String(out);
    assert.match(s, /\[quest\]\s+Preview:/i, s);
    assert.match(s, /town_prime_shard_0_0_t1_rat_culling/i, s);
    assert.match(s, /Can turn in here:\s+YES/i, s);
  } finally {
    if (prevEpoch === undefined) delete process.env.PW_QUEST_EPOCH;
    else process.env.PW_QUEST_EPOCH = prevEpoch;
  }
});
