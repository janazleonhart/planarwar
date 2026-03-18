//web-backend/test/cityAlphaScopeLock.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState, summarizeCityAlphaScopeLock } from "../gameState";

test("city alpha scope lock freezes inventory buckets and exclusions", () => {
  const ps = getOrCreatePlayerState("city_alpha_scope_lock_player");

  const summary = summarizeCityAlphaScopeLock(ps);
  assert.equal(summary.ambiguityCount, 0);
  assert.ok(summary.alphaReadyPercent > 0);
  assert.ok(summary.alreadyExists.length >= 4);
  assert.ok(summary.existsButWeak.length >= 4);
  assert.ok(summary.missing.length >= 3);
  assert.ok(summary.exclusions.length >= 4);
  assert.ok(summary.frozenExclusions.includes("No full conquest simulation in City Alpha"));
  assert.ok(summary.alreadyExists.some((item) => item.label.includes("Playable response loop")));
  assert.ok(summary.existsButWeak.some((item) => item.label.includes("World consequence linkage")));
  assert.ok(summary.missing.some((item) => item.label.includes("Persistent city-to-world influence loop")));
});
