// worldcore/test/contract_statusStackingPolicies_hot_absorb_defaults.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

test("[contract] status stacking defaults: HOT refreshes, ABSORB overwrites", () => {
  const entities = new EntityManager();
  const player = entities.createPlayerForSession("sess_stack_defaults", "prime_shard:0,0") as any;

  const now = 1000;

  // HOT should default to refresh: stackCount stays stable, duration extends.
  const hot1 = applyStatusEffectToEntity(
    player,
    {
      id: "test_hot",
      name: "Test HoT",
      durationMs: 5000,
      modifiers: {},
      tags: ["hot"],
      hot: {
        tickIntervalMs: 1000,
        perTickHeal: 2,
      },
    },
    now,
  );

  assert.equal(hot1.stackingPolicy, "refresh");
  assert.equal(hot1.stackCount, 1);
  assert.equal(hot1.expiresAtMs, now + 5000);

  const hot2 = applyStatusEffectToEntity(
    player,
    {
      id: "test_hot",
      name: "Test HoT",
      durationMs: 5000,
      modifiers: {},
      tags: ["hot"],
      hot: {
        tickIntervalMs: 1000,
        perTickHeal: 2,
      },
    },
    now + 1000,
  );

  assert.equal(hot2.stackCount, 1, "HOT refresh should not add stacks");
  assert.equal(hot2.expiresAtMs, now + 6000, "HOT refresh should extend to later expiry");

  // ABSORB should default to overwrite: remaining resets on re-application.
  const sh1 = applyStatusEffectToEntity(
    player,
    {
      id: "test_shield",
      name: "Test Shield",
      durationMs: 10000,
      modifiers: {},
      tags: ["shield"],
      absorb: {
        amount: 50,
      },
    },
    now,
  );

  assert.equal(sh1.stackingPolicy, "overwrite");
  assert.ok(sh1.absorb);
  assert.equal(sh1.absorb!.amount, 50);
  assert.equal(sh1.absorb!.remaining, 50);

  // Simulate partial depletion.
  sh1.absorb!.remaining = 10;

  const sh2 = applyStatusEffectToEntity(
    player,
    {
      id: "test_shield",
      name: "Test Shield",
      durationMs: 10000,
      modifiers: {},
      tags: ["shield"],
      absorb: {
        amount: 50,
      },
    },
    now + 500,
  );

  assert.ok(sh2.absorb);
  assert.equal(sh2.absorb!.remaining, 50, "ABSORB overwrite should reset remaining");
  assert.equal(sh2.expiresAtMs, now + 10500, "ABSORB overwrite should reset expiry to new application");
});
