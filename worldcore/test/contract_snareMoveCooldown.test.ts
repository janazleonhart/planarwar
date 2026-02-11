// worldcore/test/contract_snareMoveCooldown.test.ts
//
// Contract: "snare" imposes a move cooldown between movement verbs.
// (Normal movement has no cooldown; snare adds one.)

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

test("[contract] snare adds movement cooldown", async () => {
  const prevEnv = process.env.MUD_SNARE_MOVE_COOLDOWN_MS;
  process.env.MUD_SNARE_MOVE_COOLDOWN_MS = "1000";

  try {
    const char = makeChar({ posX: 0, posZ: 0, lastRegionId: "0,0" });

    const world: any = {
      isInsideWorld: () => true,
      getRegionAt: (x: number, z: number) => ({ id: `${x},${z}` }),
    };

    const t0 = 1_000_000;
    applyStatusEffect(
      char,
      {
        id: "snare_contract_test",
        name: "Snare",
        durationMs: 30_000,
        maxStacks: 1,
        stacks: 1,
        modifiers: {},
        tags: ["snare"],
        sourceKind: "spell",
        sourceId: "contract_snare",
        appliedByKind: "system",
        appliedById: "system",
      } as any,
      t0,
    );

    const baseCtx: any = {
      session: {
        id: "sess_test",
        identity: { userId: "user_test", flags: "" },
        roomId: "prime_shard:0,0",
      },
    };

    // First move at t0 succeeds.
    const msg1 = await handleMoveCommand({ ...baseCtx, nowMs: t0 }, char, {
      cmd: "move",
      args: ["e"],
      parts: ["move", "e"],
      world,
    });
    assert.equal(msg1, "You move east.");

    // Attempt to move again too soon is denied.
    const msg2 = await handleMoveCommand({ ...baseCtx, nowMs: t0 + 100 }, char, {
      cmd: "move",
      args: ["e"],
      parts: ["move", "e"],
      world,
    });
    assert.equal(msg2, "You are snared and cannot move yet.");

    // After cooldown window, movement is allowed again.
    const msg3 = await handleMoveCommand({ ...baseCtx, nowMs: t0 + 1000 }, char, {
      cmd: "move",
      args: ["e"],
      parts: ["move", "e"],
      world,
    });
    assert.equal(msg3, "You move east.");
  } finally {
    if (prevEnv === undefined) delete process.env.MUD_SNARE_MOVE_COOLDOWN_MS;
    else process.env.MUD_SNARE_MOVE_COOLDOWN_MS = prevEnv;
  }
});
