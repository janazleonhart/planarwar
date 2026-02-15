// worldcore/test/contract_walktoCommand_enterTown_newQuestHint.test.ts
//
// Contract: when a walkto path causes the player to enter a town-tier room, and NEW unlocked
// follow-up quests exist, the arrival message nudges toward `quest board new`.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import { handleWalkToCommand } from "../mud/commands/world/walktoCommand";
import { ensureQuestState } from "../quests/QuestState";

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  const now = new Date(0);
  return {
    id: "char_test",
    userId: "user_test",
    shardId: "prime_shard",
    name: "Tester",
    classId: "adventurer",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: "0,0",
    appearanceTag: null,
    attributes: { hp: 10, maxHp: 10 } as any,
    inventory: { items: [], gold: 0 } as any,
    equipment: { slots: {} } as any,
    spellbook: { spells: [] } as any,
    abilities: { unlocked: [] } as any,
    progression: { statusEffects: { active: {} } } as any,
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as any;
}

test("[contract] walkto entering town-tier nudges when NEW follow-ups exist", async () => {
  const char = makeChar({ posX: 0, posZ: 0, lastRegionId: "0,0" });

  // chain_intro_test unlocks chain_followup_test.
  const state = ensureQuestState(char as any);
  state["chain_intro_test"] = {
    state: "turned_in",
    completions: 1,
    source: { kind: "registry" },
  } as any;

  const world: any = {
    isInsideWorld: () => true,
    getRegionAt: (x: number, z: number) => ({ id: `${x},${z}` }),
  };

  const ctx: any = {
    nowMs: 1_000_000,
    rooms: {
      getRoom: (roomId: string) => {
        if (roomId === "prime_shard:1,0") return { id: roomId, tags: ["town_tier_1"] };
        return { id: roomId, tags: [] };
      },
    },
    session: {
      id: "sess_test",
      identity: { userId: "user_test", flags: "" },
      roomId: "prime_shard:0,0",
    },
    // Keep entities undefined so getPlayerXZ uses char.posX/posZ.
  };

  const msg = await handleWalkToCommand(ctx, char, {
    cmd: "walkto",
    args: ["--radius", "0.1", "--delay", "0", "--maxSteps", "10", "1,0"],
    parts: ["walkto", "--radius", "0.1", "--delay", "0", "--maxSteps", "10", "1,0"],
    world,
  });

  assert.match(msg, /NEW quests available:\s*1/i);
  assert.match(msg, /quest board new/i);
});
