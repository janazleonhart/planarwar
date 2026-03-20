//worldcore/test/contract_referenceKitPercentModifiersFractions.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { SPELLS } from "../spells/SpellTypes";

function assertIsFiniteNumber(value: unknown, message: string): asserts value is number {
  assert.equal(typeof value, "number", message);
  assert.ok(Number.isFinite(value), `${message} (must be finite)`);
}

test("[contract] reference-kit percentage modifiers use fractional values", () => {
  for (const [spellId, spell] of Object.entries(SPELLS)) {
    const statusEffect = spell.statusEffect;
    if (!statusEffect?.tags?.includes("reference_kit")) continue;

    const modifiers = statusEffect.modifiers;
    if (!modifiers) continue;

    const percentageModifiers: Array<[string, unknown]> = [
      ["damageTakenPct", modifiers.damageTakenPct],
      ["damageDealtPct", modifiers.damageDealtPct],
    ];

    for (const [modifierName, modifierValue] of percentageModifiers) {
      if (modifierValue === undefined) continue;
      assertIsFiniteNumber(modifierValue, `${spellId} ${modifierName} must be numeric`);
      assert.ok(
        Math.abs(modifierValue) <= 1,
        `${spellId} ${modifierName} must be fractional (e.g. 0.08 or -0.10, not ${modifierValue})`,
      );
    }
  }
});
