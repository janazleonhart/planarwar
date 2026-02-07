// worldcore/test/contract_autofire_weaponSpeedCadence.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getAutoFireIntervalMsForCharacter } from "../mud/commands/combat/autofire/autofire";

type AnyChar = any;

function makeCharBase(): AnyChar {
  return {
    id: "char_weapon_speed",
    name: "Archer",
    classId: "outrider",
    level: 1,
    shardId: "prime_shard",
    equipment: {},
    attributes: { str: 10, agi: 10, int: 10, sta: 10, wis: 10, cha: 10 },
    progression: {},
    spellbook: { known: {} },
  };
}

// Keep fallback deterministic for other tests.
process.env.PW_AUTOFIRE_MS = "30";

// For this contract, allow very small weapon speeds so we can assert exact values.
process.env.PW_AUTOFIRE_WEAPON_MIN_MS = "10";
process.env.PW_AUTOFIRE_WEAPON_MAX_MS = "10000";

test("[contract] autofire cadence: weapon speed in equipment meta overrides base cadence", () => {
  const fast = makeCharBase();
  fast.equipment = {
    ranged: { itemId: "test_bow_fast", qty: 1, meta: { speedMs: 40 } },
  };

  const slow = makeCharBase();
  slow.equipment = {
    ranged: { itemId: "test_bow_slow", qty: 1, meta: { speedMs: 85 } },
  };

  assert.equal(getAutoFireIntervalMsForCharacter(fast), 40);
  assert.equal(getAutoFireIntervalMsForCharacter(slow), 85);
});

test("[contract] autofire cadence: falls back to PW_AUTOFIRE_MS when no weapon speed is available", () => {
  const noWeapon = makeCharBase();
  noWeapon.equipment = {};

  assert.equal(getAutoFireIntervalMsForCharacter(noWeapon), 30);
});
