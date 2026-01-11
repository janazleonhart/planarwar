import test from "node:test";
import assert from "node:assert/strict";

import {
  applyStatusEffect,
  clearAllStatusEffects,
  computeCombatStatusSnapshot,
  type CombatStatusSnapshot,
} from "../combat/StatusEffects";

function makeChar(id: string): any {
  return {
    id,
    level: 1,
    progression: {},
    attributes: { str: 10, int: 10 },
  };
}

test("[contract] StatusEffects snapshot has required fields", () => {
  const c = makeChar("c");
  clearAllStatusEffects(c);

  applyStatusEffect(c, {
    id: "global_out",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageDealtPct: 0.1 },
  });

  applyStatusEffect(c, {
    id: "fire_out",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageDealtPctBySchool: { fire: 0.2 } },
  });

  const snap: CombatStatusSnapshot = computeCombatStatusSnapshot(c);

  assert.equal(typeof snap.damageDealtPct, "number");
  assert.equal(typeof snap.damageTakenPct, "number");
  assert.equal(typeof snap.armorFlat, "number");
  assert.equal(typeof snap.armorPct, "number");

  assert.equal(typeof snap.damageDealtPctBySchool, "object");
  assert.equal(typeof snap.damageTakenPctBySchool, "object");
  assert.equal(typeof snap.resistFlat, "object");
  assert.equal(typeof snap.resistPct, "object");

  assert.ok(Object.prototype.hasOwnProperty.call(snap.damageDealtPctBySchool, "fire"));
});
