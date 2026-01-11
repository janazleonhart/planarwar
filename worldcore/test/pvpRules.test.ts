// worldcore/test/pvpRules.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { resolvePlayerDamageMode } from "../pvp/PvpRules";

test("resolvePlayerDamageMode: duel wins over region PvP", () => {
  const g = resolvePlayerDamageMode(true, false);
  assert.equal(g.allowed, true);
  assert.equal(g.mode, "duel");

  const g2 = resolvePlayerDamageMode(true, true);
  assert.equal(g2.allowed, true);
  assert.equal(g2.mode, "duel");
});

test("resolvePlayerDamageMode: region PvP allows when not in duel", () => {
  const g = resolvePlayerDamageMode(false, true);
  assert.equal(g.allowed, true);
  assert.equal(g.mode, "pvp");
});

test("resolvePlayerDamageMode: fail closed when neither duel nor region PvP", () => {
  const g = resolvePlayerDamageMode(false, false);
  assert.equal(g.allowed, false);
  assert.equal(g.mode, null);
});
