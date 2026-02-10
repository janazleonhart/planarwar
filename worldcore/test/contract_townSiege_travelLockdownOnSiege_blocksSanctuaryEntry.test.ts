// worldcore/test/contract_townSiege_travelLockdownOnSiege_blocksSanctuaryEntry.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";
import { handleMoveCommand } from "../mud/commands/world/moveCommand";

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  const now = new Date();
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
    attributes: {
      hp: 50,
      maxHp: 50,
      mana: 10,
      maxMana: 10,
      stamina: 10,
      maxStamina: 10,
      strength: 1,
      intellect: 1,
      agility: 1,
      spirit: 1,
      armor: 0,
    } as any,
    inventory: { items: [], gold: 0 } as any,
    equipment: { slots: {} } as any,
    spellbook: { spells: [] } as any,
    abilities: { unlocked: [] } as any,
    progression: { unlockedSpellIds: [], unlockedAbilityIds: [] } as any,
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("[contract] travel lockdown: regions.flags rules.travel.lockdownOnSiege blocks entering sanctuary region under siege", async () => {
  setRegionFlagsTestOverrides({
    prime_shard: {
      "1,0": {
        rules: {
          ai: { townSanctuary: true },
          travel: { lockdownOnSiege: true },
        },
      },
    },
  });

  try {
    const char = makeChar({ posX: 0, posZ: 0, lastRegionId: "0,0" });

    const world: any = {
      isInsideWorld: () => true,
      getRegionAt: (x: number, z: number) => ({ id: `${x},${z}` }),
    };

    const ctx: any = {
      session: {
        id: "sess_test",
        identity: { userId: "user_test", flags: "" },
        roomId: "prime_shard:0,0",
      },
      townSiege: {
        isUnderSiege: (roomId: string) => roomId === "prime_shard:1,0",
      },
    };

    const msg = await handleMoveCommand(ctx, char, {
      cmd: "move",
      args: ["e"],
      parts: ["move", "e"],
      world,
    });

    assert.equal(msg, "The gates are sealed — the town is under siege.");
    assert.equal(char.posX, 0, "Char X should not change when entry is blocked");
    assert.equal(char.posZ, 0, "Char Z should not change when entry is blocked");
    assert.equal(char.lastRegionId, "0,0", "Region should remain unchanged when entry is blocked");
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});
