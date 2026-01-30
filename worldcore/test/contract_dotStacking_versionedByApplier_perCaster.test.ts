//worldcore/test/contract_dotStacking_versionedByApplier_perCaster.test.ts
//
// Contract: DOT effects default to versioned_by_applier stacking and do NOT overwrite
// other casters' contributions just because the spell/version matches.
//

import test from "node:test";
import assert from "node:assert/strict";

import { applyStatusEffectToEntity, getActiveStatusEffectsForEntity } from "../combat/StatusEffects";

test("[contract] DOT stacking is per-caster under versioned_by_applier default", () => {
  const now0 = 1000;

  const npc: any = {
    id: "N1",
    type: "npc",
    roomId: "room.1",
    name: "Dummy",
    hp: 100,
    maxHp: 100,
  };

  // Two different casters apply the same DOT (same sourceId), with no explicit stackingPolicy.
  applyStatusEffectToEntity(
    npc,
    {
      id: "dot_archmage_ignite",
      sourceKind: "spell",
      sourceId: "archmage_ignite",
      name: "Ignite",
      durationMs: 5000,
      modifiers: {},
      dot: { tickIntervalMs: 2000, perTickDamage: 10, damageSchool: "pure" },
      appliedByKind: "character",
      appliedById: "C1",
    },
    now0,
  );

  applyStatusEffectToEntity(
    npc,
    {
      id: "dot_archmage_ignite",
      sourceKind: "spell",
      sourceId: "archmage_ignite",
      name: "Ignite",
      durationMs: 5000,
      modifiers: {},
      dot: { tickIntervalMs: 2000, perTickDamage: 10, damageSchool: "pure" },
      appliedByKind: "character",
      appliedById: "C2",
    },
    now0 + 1,
  );

  let eff = getActiveStatusEffectsForEntity(npc, now0 + 2).filter((e) => e.id === "dot_archmage_ignite");
  assert.equal(eff.length, 2, "two casters should each have a contribution slot");

  const byC1 = eff.find((e) => e.appliedById === "C1");
  const byC2 = eff.find((e) => e.appliedById === "C2");
  assert.ok(byC1, "caster C1 slot should exist");
  assert.ok(byC2, "caster C2 slot should exist");

  // Reapply by C1 should refresh ONLY C1's slot, not delete C2.
  applyStatusEffectToEntity(
    npc,
    {
      id: "dot_archmage_ignite",
      sourceKind: "spell",
      sourceId: "archmage_ignite",
      name: "Ignite",
      durationMs: 5000,
      modifiers: {},
      dot: { tickIntervalMs: 2000, perTickDamage: 10, damageSchool: "pure" },
      appliedByKind: "character",
      appliedById: "C1",
    },
    now0 + 50,
  );

  eff = getActiveStatusEffectsForEntity(npc, now0 + 51).filter((e) => e.id === "dot_archmage_ignite");
  assert.equal(eff.length, 2, "reapply should not overwrite other casters");

  const byC2b = eff.find((e) => e.appliedById === "C2");
  assert.ok(byC2b, "caster C2 slot should still exist after C1 refresh");

  const byC1b = eff.find((e) => e.appliedById === "C1");
  assert.ok(byC1b, "caster C1 slot should still exist after refresh");
  assert.ok((byC1b!.appliedAtMs ?? 0) >= now0 + 50, "caster C1 slot should have refreshed appliedAtMs");
});
