// worldcore/test/contract_spellHotDoesNotTickPastExpiry.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { applyStatusEffect, tickStatusEffectsAndApplyHots } from "../combat/StatusEffects";

/**
 * Contract: HOT ticks must not fire past expiry.
 *
 * Example:
 * - duration = 3500ms
 * - tickInterval = 2000ms
 * - first tick at t=2000ms (allowed)
 * - second tick at t=4000ms (past expiry) => must NOT tick
 */
test("[contract] HOT does not tick past expiry boundary", () => {
  const t0 = 1_000_000;

  const char: any = {
    id: "char.1",
    name: "Tester",
    progression: {},
  };

  applyStatusEffect(
    char,
    {
      id: "hot_test_expiry",
      sourceKind: "spell",
      sourceId: "test_hot_expiry",
      name: "Test HoT",
      durationMs: 3500,
      modifiers: {} as any,
      hot: { tickIntervalMs: 2000, perTickHeal: 10 },
    },
    t0,
  );

  let ticks = 0;

  // At t=2000ms, one tick should fire.
  tickStatusEffectsAndApplyHots(char as any, t0 + 2000, () => {
    ticks++;
  });

  assert.equal(ticks, 1, "first HOT tick should fire at tickInterval boundary");

  // At t=4000ms, we're beyond expiry (t0+3500), so no further ticks.
  tickStatusEffectsAndApplyHots(char as any, t0 + 4000, () => {
    ticks++;
  });

  assert.equal(ticks, 1, "HOT must not tick after expiry");
});
