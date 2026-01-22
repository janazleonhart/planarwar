// worldcore/test/contract_statusStackingPolicy_versionedByApplier.test.ts
//
// Contract: versioned_by_applier stacking behavior
//
// IMPORTANT:
// These tests use simulated timestamps (small integers).
// Any helper that defaults to Date.now() MUST be given an explicit `now`,
// otherwise effects will be pruned as "expired".

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyStatusEffectToEntity,
  computeEntityCombatStatusSnapshot,
  getActiveStatusEffectsForEntity,
} from "../combat/StatusEffects";

function makeNpc(id = "npc.test") {
  return {
    id,
    combatStatusEffects: { active: {} },
  } as any;
}

function assertClose(actual: number, expected: number, eps = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `Expected ${actual} to be within ${eps} of ${expected}`,
  );
}

test(
  "[contract] versioned_by_applier stacks distinct versions by distinct appliers (cap enforced)",
  () => {
    const npc = makeNpc();
    const base = {
      id: "weakness",
      sourceKind: "spell" as const,
      durationMs: 60_000,
      stackingPolicy: "versioned_by_applier" as const,
      maxStacks: 2,
    };

    // Two different versions from two different appliers stack.
    applyStatusEffectToEntity(
      npc,
      {
        ...base,
        sourceId: "spell_weakness_rank1",
        versionKey: "rank1",
        appliedByKind: "character",
        appliedById: "char.A",
        modifiers: { damageTakenPct: 0.1 },
      },
      1_000,
    );

    applyStatusEffectToEntity(
      npc,
      {
        ...base,
        sourceId: "spell_weakness_rank2",
        versionKey: "rank2",
        appliedByKind: "character",
        appliedById: "char.B",
        modifiers: { damageTakenPct: 0.2 },
      },
      1_010,
    );

    const now1 = 1_020;
    const active = getActiveStatusEffectsForEntity(npc, now1).filter(
      (e) => e.id === "weakness",
    );
    assert.equal(active.length, 2);

    const snap = computeEntityCombatStatusSnapshot(npc, now1);
    assertClose(snap.damageTakenPct, 0.3);

    // Third distinct version + applier is rejected by cap.
    applyStatusEffectToEntity(
      npc,
      {
        ...base,
        sourceId: "spell_weakness_rank3",
        versionKey: "rank3",
        appliedByKind: "character",
        appliedById: "char.C",
        modifiers: { damageTakenPct: 0.5 },
      },
      1_030,
    );

    const now2 = 1_040;
    const active2 = getActiveStatusEffectsForEntity(npc, now2).filter(
      (e) => e.id === "weakness",
    );
    assert.equal(active2.length, 2);

    const snap2 = computeEntityCombatStatusSnapshot(npc, now2);
    assertClose(snap2.damageTakenPct, 0.3);
  },
);

test(
  "[contract] versioned_by_applier: same applier upgrades their slot (no duplicate, still capped)",
  () => {
    const npc = makeNpc();
    const base = {
      id: "weakness",
      sourceKind: "spell" as const,
      durationMs: 60_000,
      stackingPolicy: "versioned_by_applier" as const,
      maxStacks: 3,
      appliedByKind: "character" as const,
      appliedById: "char.A",
    };

    applyStatusEffectToEntity(
      npc,
      {
        ...base,
        sourceId: "spell_weakness_rank1",
        versionKey: "rank1",
        modifiers: { damageTakenPct: 0.1 },
      },
      2_000,
    );

    // Same applier applies a new version: replaces their own slot.
    applyStatusEffectToEntity(
      npc,
      {
        ...base,
        sourceId: "spell_weakness_rank2",
        versionKey: "rank2",
        modifiers: { damageTakenPct: 0.2 },
      },
      2_010,
    );

    const now = 2_020;
    const active = getActiveStatusEffectsForEntity(npc, now).filter(
      (e) => e.id === "weakness",
    );
    assert.equal(active.length, 1);
    assert.equal(active[0]!.sourceId, "spell_weakness_rank2");

    const snap = computeEntityCombatStatusSnapshot(npc, now);
    assertClose(snap.damageTakenPct, 0.2);
  },
);

test(
  "[contract] versioned_by_applier: same version does not stack (last-write-wins refresh/replace)",
  () => {
    const npc = makeNpc();
    const base = {
      id: "weakness",
      sourceKind: "spell" as const,
      durationMs: 60_000,
      stackingPolicy: "versioned_by_applier" as const,
      maxStacks: 3,
      versionKey: "rank1" as const,
    };

    applyStatusEffectToEntity(
      npc,
      {
        ...base,
        sourceId: "spell_weakness_rank1",
        appliedByKind: "character",
        appliedById: "char.A",
        modifiers: { damageTakenPct: 0.1 },
      },
      3_000,
    );

    // Different applier tries the SAME versionKey: replaces, does not add a second slot.
    applyStatusEffectToEntity(
      npc,
      {
        ...base,
        sourceId: "spell_weakness_rank1",
        appliedByKind: "character",
        appliedById: "char.B",
        modifiers: { damageTakenPct: 0.2 },
      },
      3_010,
    );

    const now = 3_020;
    const active = getActiveStatusEffectsForEntity(npc, now).filter(
      (e) => e.id === "weakness",
    );
    assert.equal(active.length, 1);
    assert.equal(active[0]!.appliedById, "char.B");

    const snap = computeEntityCombatStatusSnapshot(npc, now);
    assertClose(snap.damageTakenPct, 0.2);
  },
);
