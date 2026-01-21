// worldcore/test/contract_castingGates_costCooldown.test.ts
//
// Contract tests for centralized action gating (cost + cooldown).
// We use node:test (same as the rest of the suite), not jest/mocha.

import assert from "node:assert/strict";
import test from "node:test";

import { applyActionCostAndCooldownGates } from "../combat/CastingGates";
import { getCooldownRemaining } from "../combat/Cooldowns";
import { getOrInitPowerResource } from "../resources/PowerResources";

test("[contract] casting gates: resource failure must not start cooldown", () => {
  const char: any = {
    classId: "mage",
    level: 1,
    progression: {},
  };

  const mana = getOrInitPowerResource(char, "mana");
  mana.current = 5;

  const now = 10_000;

  const err = applyActionCostAndCooldownGates({
    char,
    bucket: "spells",
    key: "arcane_bolt",
    displayName: "Arcane Bolt",
    cooldownMs: 2500,
    resourceType: "mana",
    resourceCost: 10,
    now,
  });

  assert.ok(err, "Expected an error string for insufficient resource");
  assert.equal(
    getCooldownRemaining(char, "spells", "arcane_bolt", now),
    0,
    "Cooldown must not start when resource spending fails",
  );
  assert.equal(mana.current, 5, "Resource must not be spent on failure");
});

test("[contract] casting gates: cooldown blocks must not spend resource", () => {
  const char: any = {
    classId: "mage",
    level: 1,
    progression: {},
  };

  const mana = getOrInitPowerResource(char, "mana");
  mana.current = 50;

  const now = 10_000;

  const first = applyActionCostAndCooldownGates({
    char,
    bucket: "spells",
    key: "arcane_bolt",
    displayName: "Arcane Bolt",
    cooldownMs: 2500,
    resourceType: "mana",
    resourceCost: 10,
    now,
  });
  assert.equal(first, null, "First cast should succeed");

  const afterFirstMana = mana.current;
  assert.equal(afterFirstMana, 40, "First cast must spend mana");

  // Attempt again while still on cooldown
  const second = applyActionCostAndCooldownGates({
    char,
    bucket: "spells",
    key: "arcane_bolt",
    displayName: "Arcane Bolt",
    cooldownMs: 2500,
    resourceType: "mana",
    resourceCost: 10,
    now: now + 100,
  });

  assert.ok(second && second.toLowerCase().includes("cooldown"));
  assert.equal(
    mana.current,
    afterFirstMana,
    "Mana must NOT be spent when cooldown blocks",
  );
});

test("[contract] casting gates: success spends resource then starts cooldown", () => {
  const char: any = {
    classId: "mage",
    level: 1,
    progression: {},
  };

  const mana = getOrInitPowerResource(char, "mana");
  mana.current = 50;

  const now = 10_000;

  const err = applyActionCostAndCooldownGates({
    char,
    bucket: "spells",
    key: "arcane_bolt",
    displayName: "Arcane Bolt",
    cooldownMs: 2500,
    resourceType: "mana",
    resourceCost: 10,
    now,
  });

  assert.equal(err, null, "Expected success (null error)");
  assert.equal(mana.current, 40, "Mana should be spent on success");

  const remaining = getCooldownRemaining(char, "spells", "arcane_bolt", now);
  assert.ok(remaining > 0, "Cooldown should be active after success");
});
