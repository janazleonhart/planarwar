// worldcore/test/contract_rootBlocksMoveCommand.test.ts
//
// Contract: "root" crowd control prevents movement verbs.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import { handleMoveCommand } from "../mud/commands/world/moveCommand";
import { applyStatusEffect } from "../combat/StatusEffects";

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

test("[contract] root blocks move command", async () => {
  const char = makeChar({ posX: 0, posZ: 0, lastRegionId: "0,0" });

  const nowMs = 1_000_000;
  applyStatusEffect(
    char,
    {
      id: "root_contract_test",
      name: "Root",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["root"],
      sourceKind: "spell",
      sourceId: "contract_root",
      appliedByKind: "system",
      appliedById: "system",
    } as any,
    nowMs,
  );

  const world: any = {
    isInsideWorld: () => true,
    getRegionAt: (x: number, z: number) => ({ id: `${x},${z}` }),
  };

  const ctx: any = {
    nowMs,
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

  assert.equal(msg, "You are rooted.");
  assert.equal(char.posX, 0);
  assert.equal(char.posZ, 0);
});
