// worldcore/test/contract_quest_debug_tuning_source_report_v0_32.test.ts
//
// Contract (Quest Board v0.32): staff-only debug tuning includes a stable "source report"
// for each tuning knob (base / tier / profile / preset). This is purely internal diagnostics.

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
    id: "char_test_quest_debug_tuning_sources",
    userId: "user_test_quest_debug_tuning_sources",
    shardId: "prime_shard",
    name: "Quest Debug Tuning Sources Tester",
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
    id: "sess_test_quest_debug_tuning_sources",
    auth: { isDev: true },
    roomId,
  };

  const entities = {
    getEntityByOwner: (ownerId: string) => (ownerId === session.id ? { id: "ent_player", roomId } : null),
  };

  const rooms = {
    getRoom: (id: string) =>
      id === roomId
        ? {
            id: roomId,
            regionId: roomId,
            tags: ["starter", "town_tier_2", "town_profile_trade", "town_tuning_strict"],
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
    raw,
  } as any;
}

test("[contract] quest debug tuning includes source report markers (v0.32)", async () => {
  const roomId = "prime_shard:0,0";
  const ctx = makeCtx(roomId);
  const char = makeChar(roomId);

  const input = parsedQuestInput(["debug", "tuning"], "quest debug tuning");
  const out = await handleQuestCommand(ctx as any, char as any, input as any);

  // Always present.
  assert.match(out, /Quest Board Debug Tuning \(staff\):/i);

  // Base caps should be marked as base (these are not overridden today).
  assert.match(out, /kindBaseCap:\s*\d+\s*\(base\)/i);

  // Strict preset should win and be tagged as such.
  assert.match(out, /avoidRecentUntilFrac:\s*0\.9[0-9]\s*\(preset:strict\)/i);
  assert.match(out, /avoidRecentShapesUntilFrac:\s*0\.9[0-9]\s*\(preset:strict\)/i);
});
