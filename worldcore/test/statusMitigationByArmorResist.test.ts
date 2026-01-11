// worldcore/test/statusMitigationByArmorResist.test.ts
//
// Verifies that defender status effects can modify armor/resists used during mitigation.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import { applyStatusEffect, computeCombatStatusSnapshot } from "../combat/StatusEffects";
import { computeDamage } from "../combat/CombatEngine";
import { withRandomSequence } from "./testUtils";

function mkChar(partial: Partial<CharacterState> = {}): CharacterState {
  return {
    id: partial.id ?? "c1",
    accountId: (partial as any).accountId ?? "a1",
    displayName: (partial as any).displayName ?? "Testy",
    name: (partial as any).name ?? "Testy",
    classId: (partial as any).classId ?? "adventurer",
    level: partial.level ?? 1,
    attributes: (partial as any).attributes ?? { str: 10, int: 10, sta: 10, dex: 10, wis: 10 },
    progression: (partial as any).progression ?? {
      xp: 0,
      levelXp: 0,
      skillXp: {},
      titles: [],
      statusEffects: [],
    },
    inventory: (partial as any).inventory ?? [],
    equipment: (partial as any).equipment ?? {},
    position: (partial as any).position ?? { shardId: "prime_shard", roomId: "prime_shard:0,0", x: 0, y: 0, z: 0 },
  } as any;
}

test("Defender armorPct modifies physical mitigation (armor)", () => {
  const attacker = mkChar({ id: "atk" });
  const defender = mkChar({ id: "def" });

  applyStatusEffect(defender, {
    id: "fortified_armor",
    name: "Fortified Armor",
    durationMs: 60_000,
    sourceKind: "spell",
    sourceId: "fortify_armor",
    maxStacks: 1,
    modifiers: { armorPct: 1.0 }, // +100% armor
  });

  const defenderStatus = computeCombatStatusSnapshot(defender);

  const baseTarget = { entity: { id: "t" } as any, armor: 100, resist: {} as any };

  const noBuff = withRandomSequence([0.5, 0.99], () =>
    computeDamage(
      { char: attacker, effective: { str: 10, int: 10 }, channel: "ability" },
      baseTarget,
      { basePower: 10, damageSchool: "physical" },
    ),
  );

  const withBuff = withRandomSequence([0.5, 0.99], () =>
    computeDamage(
      { char: attacker, effective: { str: 10, int: 10 }, channel: "ability" },
      { ...baseTarget, defenderStatus },
      { basePower: 10, damageSchool: "physical" },
    ),
  );

  assert.equal(noBuff.damage, 5);
  assert.equal(withBuff.damage, 3);
});

test("Defender resistPct modifies spell mitigation (resists)", () => {
  const attacker = mkChar({ id: "atk" });
  const defender = mkChar({ id: "def" });

  applyStatusEffect(defender, {
    id: "ward_fire",
    name: "Ward: Fire",
    durationMs: 60_000,
    sourceKind: "spell",
    sourceId: "ward_fire",
    maxStacks: 1,
    modifiers: { resistPct: { fire: 1.0 } as any }, // +100% fire resist
  });

  const defenderStatus = computeCombatStatusSnapshot(defender);

  const baseTarget = { entity: { id: "t" } as any, armor: 0, resist: { fire: 100 } as any };

  const noBuff = withRandomSequence([0.5, 0.99], () =>
    computeDamage(
      { char: attacker, effective: { str: 10, int: 10 }, channel: "spell", spellSchool: "fire" as any },
      baseTarget,
      { basePower: 10, damageSchool: "fire" },
    ),
  );

  const withBuff = withRandomSequence([0.5, 0.99], () =>
    computeDamage(
      { char: attacker, effective: { str: 10, int: 10 }, channel: "spell", spellSchool: "fire" as any },
      { ...baseTarget, defenderStatus },
      { basePower: 10, damageSchool: "fire" },
    ),
  );

  assert.equal(noBuff.damage, 5);
  assert.equal(withBuff.damage, 2);
});
