// worldcore/test/contract_duelMelee_parryBlockRiposte_math.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { computeDuelMeleeDamageFromPhysicalResult } from "../mud/actions/MudCombatActions";

function makePhys(outcome: any, extra: any = {}): any {
  return {
    outcome,
    strikes: 1,
    critChance: 0,
    glancingChance: 0,
    riposte: false,
    blockMultiplier: 1,
    hitChance: 1,
    ...extra,
  };
}

test("[contract] duel melee math: block reduces damage; hit does full damage", async () => {
  const baseDamage = 11;

  const hit = computeDuelMeleeDamageFromPhysicalResult({
    baseDamage,
    openerMultiplier: 1,
    phys: makePhys("hit"),
    rng: () => 0.99,
  });

  assert.equal(hit.outcome, "hit");
  assert.equal(hit.damageToTarget, 11);
  assert.equal(hit.riposteDamage, 0);

  const block = computeDuelMeleeDamageFromPhysicalResult({
    baseDamage,
    openerMultiplier: 1,
    phys: makePhys("block", { blockMultiplier: 0.7 }),
    rng: () => 0.99,
  });

  assert.equal(block.outcome, "block");
  assert.equal(block.damageToTarget, 8, "expected rounded 11*0.7 => 8");
  assert.equal(block.riposteDamage, 0);
});

test("[contract] duel melee math: parry deals no damage and may riposte", async () => {
  const prevChance = process.env.PW_RIPOSTE_CHANCE_ON_PARRY;
  const prevMult = process.env.PW_RIPOSTE_DAMAGE_MULTIPLIER;
  try {
    process.env.PW_RIPOSTE_CHANCE_ON_PARRY = "1";
    process.env.PW_RIPOSTE_DAMAGE_MULTIPLIER = "0.5";

    const parry = computeDuelMeleeDamageFromPhysicalResult({
      baseDamage: 10,
      openerMultiplier: 1,
      phys: makePhys("parry", { riposte: true }),
      riposteBaseDamage: 20,
      rng: () => 0,
    });

    assert.equal(parry.outcome, "parry");
    assert.equal(parry.damageToTarget, 0);
    assert.ok(parry.didRiposte, "expected riposte to trigger");
    assert.equal(parry.riposteDamage, 10, "expected 20*0.5 => 10");
  } finally {
    if (prevChance === undefined) delete process.env.PW_RIPOSTE_CHANCE_ON_PARRY;
    else process.env.PW_RIPOSTE_CHANCE_ON_PARRY = prevChance;

    if (prevMult === undefined) delete process.env.PW_RIPOSTE_DAMAGE_MULTIPLIER;
    else process.env.PW_RIPOSTE_DAMAGE_MULTIPLIER = prevMult;
  }
});
