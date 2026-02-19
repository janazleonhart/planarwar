//worldcore/test/contract_spellStatusEffects_overwrite_replaces_dot_payload.test.ts
//
// Contract: stackingPolicy "overwrite" replaces DOT payload (perTickDamage, tickIntervalMs)
// and resets tick scheduling under a shared stackingGroupId (rank upgrade).
//

import test from "node:test";
import assert from "node:assert/strict";

import { applyStatusEffectToEntity, getActiveStatusEffectsForEntity } from "../combat/StatusEffects";

// Minimal NPC entity for status effect application.
function makeNpc(): any {
  return {
    id: "N_dot",
    type: "npc",
    roomId: "room.1",
    name: "Dummy",
    hp: 100,
    maxHp: 100,
  };
}

test("[contract] overwrite stackingPolicy replaces DOT payload and resets tick schedule (rank upgrade)", () => {
  const npc = makeNpc();
  const group = "grp_ranked_dot";

  const now1 = 1_000_000;

  applyStatusEffectToEntity(
    npc,
    {
      id: "dot_ranked",
      sourceKind: "spell",
      sourceId: "test_ranked_dot_i",
      name: "Test Ranked DoT",
      stackingGroupId: group,
      stackingPolicy: "overwrite",
      durationMs: 10_000,
      modifiers: {},
      dot: { tickIntervalMs: 1000, perTickDamage: 6, damageSchool: "pure" },
      appliedByKind: "character",
      appliedById: "C1",
    },
    now1,
  );

  const eff1 = getActiveStatusEffectsForEntity(npc, now1);
  const inst1 = eff1.find((e) => e && e.stackingGroupId === group) ?? null;
  assert.ok(inst1, "expected stackingGroupId instance to exist on npc");
  assert.ok(inst1.dot, "expected DOT payload to exist");
  assert.equal(inst1.dot?.perTickDamage, 6);
  assert.equal(inst1.dot?.tickIntervalMs, 1000);
  assert.equal(inst1.dot?.nextTickAtMs, now1 + 1000);

  const now2 = now1 + 500;

  // Overwrite with Rank II payload.
  applyStatusEffectToEntity(
    npc,
    {
      id: "dot_ranked",
      sourceKind: "spell",
      sourceId: "test_ranked_dot_ii",
      name: "Test Ranked DoT",
      stackingGroupId: group,
      stackingPolicy: "overwrite",
      durationMs: 10_000,
      modifiers: {},
      dot: { tickIntervalMs: 700, perTickDamage: 13, damageSchool: "pure" },
      appliedByKind: "character",
      appliedById: "C1",
    },
    now2,
  );

  const eff2 = getActiveStatusEffectsForEntity(npc, now2);
  const inst2 = eff2.find((e) => e && e.stackingGroupId === group) ?? null;
  assert.ok(inst2, "expected stackingGroupId instance to exist after overwrite");
  assert.ok(inst2.dot, "expected DOT payload to exist after overwrite");

  assert.equal(inst2.dot?.perTickDamage, 13, "expected overwrite to replace perTickDamage");
  assert.equal(inst2.dot?.tickIntervalMs, 700, "expected overwrite to replace tickIntervalMs");
  assert.equal(inst2.dot?.nextTickAtMs, now2 + 700, "expected overwrite to reset nextTickAtMs based on new interval");

  const bucketed = eff2.filter((e) => e && e.stackingGroupId === group);
  assert.equal(bucketed.length, 1, "expected exactly one instance for the stackingGroupId bucket");
});
