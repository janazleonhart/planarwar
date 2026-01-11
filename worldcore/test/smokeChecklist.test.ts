import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";
import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import { applyStatusEffect, clearAllStatusEffects } from "../combat/StatusEffects";
import { withRandomSequence } from "./testUtils";

function makeChar(id: string): any {
  return {
    id,
    level: 1,
    progression: {},
    attributes: { str: 10, int: 10 },
  };
}

function makeEntity(hp: number): any {
  return { id: "ent", hp, maxHp: hp, alive: true };
}

test("[smoke] computeDamage returns sane numbers (no NaN, >=1)", () => {
  const attacker = makeChar("a");
  const source: any = { char: attacker, effective: {}, channel: "weapon" };
  const target: any = { entity: makeEntity(100), armor: 0, resist: {} };

  withRandomSequence([0.5, 0.99, 0.99], () => {
    const r = computeDamage(source, target, { basePower: 10, damageSchool: "physical" });
    assert.ok(Number.isFinite(r.damage));
    assert.ok(r.damage >= 1);
  });
});

test("[smoke] outgoing global + per-school stacks additively", () => {
  const attacker = makeChar("a");
  clearAllStatusEffects(attacker);

  applyStatusEffect(attacker, {
    id: "global",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageDealtPct: 0.25 },
  });

  applyStatusEffect(attacker, {
    id: "fire_only",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageDealtPctBySchool: { fire: 0.5 } },
  });

  const source: any = { char: attacker, effective: {}, channel: "spell" };
  const target: any = { entity: makeEntity(100), armor: 0, resist: {} };

  // roll=1.0, critRoll=0.99 (no crit)
  withRandomSequence([0.5, 0.99], () => {
    const r = computeDamage(source, target, { basePower: 10, damageSchool: "fire" });
    // 10 * (1 + 0.25 + 0.5) = 17.5 floored => 17
    assert.equal(r.damage, 17);
  });
});

test("[smoke] mitigation reduces damage (armor/resist)", () => {
  const attacker = makeChar("a");
  const source: any = { char: attacker, effective: {}, channel: "spell" };

  // roll=1.0, no crit
  withRandomSequence([0.5, 0.99], () => {
    const r = computeDamage(
      source,
      { entity: makeEntity(100), armor: 0, resist: { fire: 100 } } as any,
      { basePower: 10, damageSchool: "fire" },
    );
    assert.ok(r.damage < 10);
    assert.ok(r.damage >= 1);
  });
});

test("[smoke] incoming global + per-school stacks additively (and not for physical)", () => {
  const targetChar = makeChar("t");
  clearAllStatusEffects(targetChar);

  applyStatusEffect(targetChar, {
    id: "global_taken",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageTakenPct: 0.25 },
  });

  applyStatusEffect(targetChar, {
    id: "fire_taken",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageTakenPctBySchool: { fire: 0.5 } },
  });

  const fireEnt = makeEntity(1000);
  applySimpleDamageToPlayer(fireEnt as any, 100, targetChar, "fire");
  assert.equal(fireEnt.hp, 825); // 100 * 1.75 = 175

  const physEnt = makeEntity(1000);
  applySimpleDamageToPlayer(physEnt as any, 100, targetChar, "physical");
  assert.equal(physEnt.hp, 875); // only global applies => 125
});

test("[smoke] ordering stays floor-sensitive: mitigation first, then incoming multipliers", () => {
  const attacker = makeChar("a");
  const targetChar = makeChar("t");
  clearAllStatusEffects(targetChar);

  applyStatusEffect(targetChar, {
    id: "fire_taken",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageTakenPctBySchool: { fire: 0.25 } },
  });

  const source: any = { char: attacker, effective: {}, channel: "spell" };
  const target: any = { entity: makeEntity(100), armor: 0, resist: { fire: 100 } };

  // roll=1.0, no crit
  withRandomSequence([0.5, 0.99], () => {
    // basePower=5 => resist => 2.5 floored => 2
    const r = computeDamage(source, target, { basePower: 5, damageSchool: "fire" });
    applySimpleDamageToPlayer(target.entity, r.damage, targetChar, r.school);
    // incoming: 2 * 1.25 => 2.5 floored => 2
    assert.equal(target.entity.hp, 98);
  });
});

test("[smoke] min-damage rule: any positive fractional damage becomes 1", () => {
  const targetChar = makeChar("t");
  const ent = makeEntity(10);
  applySimpleDamageToPlayer(ent as any, 0.1, targetChar, "physical");
  assert.equal(ent.hp, 9);
});
