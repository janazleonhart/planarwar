// worldcore/test/contract_moveCommand_enterTown_readyTurninHint.test.ts
//
// Contract: when entering a town-tier room, if the player has completed quests
// that are eligible to turn in *here* under restricted turn-in policies (board/npc),
// movement nudges toward `quest turnin list here`.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import { handleMoveCommand } from "../mud/commands/world/moveCommand";
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

test("[contract] move entering town-tier nudges when restricted-policy turn-ins are ready here", async () => {
  const char = makeChar({ posX: 0, posZ: 0, lastRegionId: "0,0" });

  // Completed quest with board-only policy bound to prime_shard:1,0 (see QuestTypes).
  const state = ensureQuestState(char as any);
  state["board_turnin_test"] = {
    state: "completed",
    completions: 0,
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
        // Starting room is non-town. Destination (1,0) is town tier 1.
        if (roomId === "prime_shard:1,0") return { id: roomId, tags: ["town_tier_1"] };
        return { id: roomId, tags: [] };
      },
    },
    session: {
      id: "sess_test",
      identity: { userId: "user_test", flags: "" },
      roomId: "prime_shard:0,0",
    },
  };

  const msg = await handleMoveCommand(ctx, char, {
    cmd: "move",
    args: ["e"],
    parts: ["move", "e"],
    world,
  });

  assert.match(msg, /Quests ready to turn in here:\s*1/i);
  assert.match(msg, /quest turnin list here/i);
});
