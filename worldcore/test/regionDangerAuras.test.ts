// worldcore/test/regionDangerAuras.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  getRegionDangerAuraStrengthForTier,
  updateRegionDangerAuraForCharacter,
} from "../combat/RegionDangerAuras";

import {
  getRegionDangerForRegionId,
  setRegionDangerScore,
} from "../world/RegionDanger";

import { computeCombatStatusSnapshot } from "../combat/StatusEffects";

import {
  type CharacterState,
  defaultAttributes,
  defaultInventory,
  defaultEquipment,
  defaultSpellbook,
  defaultAbilities,
  defaultProgression,
} from "../characters/CharacterTypes";

function makeCharWithRegion(regionId: string): CharacterState {
  const now = new Date();
  const progression = defaultProgression() as any;
  if (!progression.flags) {
    progression.flags = {};
  }

  return {
    id: "char-danger-aura",
    userId: "user-danger-aura",
    shardId: "prime_shard",
    name: "DangerAuraTester",
    classId: "warrior",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: regionId,
    appearanceTag: null,
    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
    progression,
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
    guildId: null,
  };
}

test("RegionDangerAuras: strength is 0 below threshold and >0 at/above", () => {
  // Default config: threshold=3, strength=0.05
  assert.equal(
    getRegionDangerAuraStrengthForTier(1),
    0,
    "Tier 1 should have no aura",
  );
  assert.equal(
    getRegionDangerAuraStrengthForTier(2),
    0,
    "Tier 2 should have no aura",
  );
  assert.ok(
    getRegionDangerAuraStrengthForTier(3) > 0,
    "Tier 3 should have a non-zero aura strength",
  );
  assert.ok(
    getRegionDangerAuraStrengthForTier(4) > 0,
    "Tier 4 should have a non-zero aura strength",
  );
  assert.ok(
    getRegionDangerAuraStrengthForTier(5) > 0,
    "Tier 5 should have a non-zero aura strength",
  );
});

test("RegionDangerAuras: low-danger region does not apply damageTakenPct aura", () => {
  const regionId = "prime_shard:0,0"; // radius=0 → base tier 1
  // Reset any prior danger score for this region to avoid cross-test pollution.
  setRegionDangerScore(regionId, 0, "test:reset", 0);

  const tier = getRegionDangerForRegionId(regionId, 0);
  assert.equal(
    tier,
    1,
    "Sanity: center region should be tier 1 for this test",
  );

  const char = makeCharWithRegion(regionId);

  const statusBefore = computeCombatStatusSnapshot(char, 0);
  const beforeTakenPct = statusBefore.damageTakenPct ?? 0;
  assert.equal(
    beforeTakenPct,
    0,
    "Baseline damageTakenPct should be 0 with no effects",
  );

  updateRegionDangerAuraForCharacter(char, 0);

  const statusAfter = computeCombatStatusSnapshot(char, 0);
  const afterTakenPct = statusAfter.damageTakenPct ?? 0;

  assert.equal(
    afterTakenPct,
    0,
    "Low-danger region should not add any damageTakenPct aura",
  );
});

test("RegionDangerAuras: high-danger region applies +5% damageTakenPct aura", () => {
  const regionId = "prime_shard:5,0"; // radius=5 → base tier 4
  // Reset score so we know we're purely on base tier.
  setRegionDangerScore(regionId, 0, "test:reset", 0);

  const tier = getRegionDangerForRegionId(regionId, 0);
  assert.equal(
    tier,
    4,
    "Sanity: region at radius 5 should be tier 4",
  );

  const char = makeCharWithRegion(regionId);

  const statusBefore = computeCombatStatusSnapshot(char, 0);
  const beforeTakenPct = statusBefore.damageTakenPct ?? 0;
  assert.equal(
    beforeTakenPct,
    0,
    "Baseline damageTakenPct should be 0 with no effects",
  );

  updateRegionDangerAuraForCharacter(char, 0);

  const statusAfter = computeCombatStatusSnapshot(char, 0);
  const afterTakenPct = statusAfter.damageTakenPct ?? 0;

  assert.ok(
    afterTakenPct > 0,
    "High-danger region should add a non-zero damageTakenPct",
  );

  // Default aura config is +5% → 0.05. Allow a small numeric tolerance.
  assert.ok(
    afterTakenPct > 0.045 && afterTakenPct < 0.055,
    `Expected damageTakenPct to be ~0.05 for danger aura, got ${afterTakenPct}`,
  );
});
