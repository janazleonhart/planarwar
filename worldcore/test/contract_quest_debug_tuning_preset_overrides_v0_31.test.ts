// worldcore/test/contract_quest_debug_tuning_preset_overrides_v0_31.test.ts
//
// Contract (Quest Board v0.31): town tuning preset tags apply deterministic tuning overrides
// (staff-only via `quest debug tuning`). This should not affect player-facing text.

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

import { handleQuestCommand } from "../mud/commands/progression/questsCommand";

type AnyCtx = any;

function makeChar(roomId: string): CharacterState {
  return {
    id: "char_test_quest_debug_tuning_preset",
    userId: "user_test_quest_debug_tuning_preset",
    shardId: "prime_shard",
    name: "Quest Debug Tuning Preset Tester",
    classId: "adventurer" as any,
    raceId: "human" as any,
    gender: "neutral" as any,
    isNpc: false as any,
    isAlive: true as any,
    roomId,
    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
    progression: defaultProgression(),
  } as any;
}

function makeCtx(roomId: string): AnyCtx {
  const session = {
    id: "sess_test_quest_debug_tuning_preset",
    auth: { isDev: true },
    roomId,
  };

  const entities = {
    // TownQuestBoard prefers resolving current roomId from the player entity by owner.
    getEntityByOwner: (ownerId: string) =>
      ownerId === session.id ? { id: "ent_player", roomId } : null,
  };

  const rooms = {
    getRoom: (id: string) =>
      id === roomId
        ? {
            id: roomId,
            regionId: roomId,
            // Tier/profile/preset tags are read from the room.
            tags: ["starter", "town_tier_3", "town_profile_trade", "town_tuning_strict"],
          }
        : null,
  };

  const characters = {
    patchCharacter: async () => {},
  };

  return { session, entities, rooms, characters } as AnyCtx;
}

function parsedQuestInput(args: string[], raw: string) {
  return {
    cmd: "quest",
    args: args.slice(0),
    parts: ["quest", ...args],
    // Some handlers accept `input.raw`; harmless if ignored.
    raw,
  } as any;
}

test("[contract] quest debug tuning shows tuning preset overrides (v0.31)", async () => {
  const roomId = "prime_shard:0,0";
  const ctx = makeCtx(roomId);
  const char = makeChar(roomId);

  const input = parsedQuestInput(["debug", "tuning"], "quest debug tuning");
  const out = await handleQuestCommand(ctx as any, char as any, input as any);

  assert.match(out, /tuningPresetTags:/i);
  assert.match(out, /town_tuning_strict/i);
  assert.match(out, /tuningPreset:\s*strict/i);

  // Strict preset should push both avoidRecent fractions high.
  assert.match(out, /avoidRecentUntilFrac:\s*0\.9[0-9]/i);
  assert.match(out, /avoidRecentShapesUntilFrac:\s*0\.9[0-9]/i);
});
