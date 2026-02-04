// worldcore/test/contract_npcThreat_decay_integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import { updateThreatFromDamage, getThreatValue } from "../npc/NpcThreat";

test("[contract] npc threat: decay integrates via updateThreatFromDamage (action-driven)", () => {
  const t0 = 1_000_000;
  const t1 = t0 + 5_000; // 5s later

  // Initial provocation: attacker A builds 10 threat.
  const s0 = updateThreatFromDamage(undefined, "a", 10, t0);

  // Later, attacker B pokes for 1 threat. The existing table should decay BEFORE the poke is applied.
  const s1 = updateThreatFromDamage(s0, "b", 1, t1);

  // Default decayPerSec is 1, so 5 seconds should subtract 5.
  // A: 10 - 5 = 5
  assert.equal(getThreatValue(s1, "a"), 5);
  // B gets its 1 threat.
  assert.equal(getThreatValue(s1, "b"), 1);
});
