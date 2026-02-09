// worldcore/test/contract_combatEngine_parry_block.test.ts
//
// Contract: CombatEngine parry/block are opt-in toggles, are side-effect free,
// and (when enabled) apply in a deterministic order without surprising RNG leaks.

import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

function makeSource(channel: "weapon" | "spell" | "ability" = "weapon"): any {
  return {
    char: { id: "c1", classId: "outrider", level: 10, attributes: { str: 20, int: 10 } },
    effective: { str: 20, int: 10 },
    channel,
    weaponSkill: "ranged",
    spellSchool: "arcane",
  };
}

function makeTarget(): any {
  return { entity: { id: "t1", name: "Target", type: "npc" }, armor: 0, resist: {} };
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("[contract] CombatEngine: parry returns early (no crit/glance RNG consumption)", () => {
  const src = makeSource("weapon");
  const tgt = makeTarget();

  let calls = 0;
  const rand = () => {
    calls++;
    return 0.0;
  };

  const out = withEnv(
    {
      PW_PARRY_ENABLED: "1",
      PW_PARRY_CHANCE_BASE: "0.0", // irrelevant due to forceParry
      PW_CRIT_CHANCE_BASE: "1.0",
      PW_GLANCE_CHANCE_BASE: "1.0",
    },
    () =>
      computeDamage(
        src,
        tgt,
        {
          basePower: 100,
          forceParry: true,
          rng: rand,
        }
      )
  );

  assert.equal(out.damage, 0);
  assert.equal(out.wasParried, true);
  assert.equal(out.wasCrit, false);
  assert.equal(out.wasGlancing, false);
  // Calls:
  // 1) base roll, 2) parry roll is NOT consumed because forceParry bypasses rand? Wait: we still call rand for base roll.
  // In parry path we should consume:
  // - base roll
  // - (parry roll only if not forced)
  assert.equal(calls, 1);
});

test("[contract] CombatEngine: block applies after crit/glance multipliers (physical only)", () => {
  const src = makeSource("weapon");
  const tgt = makeTarget();

  // RNG order in computeDamage (weapon) is intended to be:
  // 1) base roll
  // 2) crit roll
  // 3) glance roll
  // 4) block roll
  //
  // But other optional combat hooks may (intentionally) add an extra RNG draw
  // *after* the glance check. So we include a spare 0.0 to keep the contract
  // stable even if one extra draw is introduced.
  const rand = rngSeq([
    0.5, // base roll => 1.0
    0.0, // crit roll => crit
    1.0, // glance roll => no glance
    0.0, // spare draw (if any)
    0.0, // block roll => block
  ]);

  const out = withEnv(
    {
      PW_CRIT_CHANCE_BASE: "1.0",
      PW_GLANCE_CHANCE_BASE: "0.0",
      PW_CRIT_MULTIPLIER: "2.0",
      PW_GLANCE_MULTIPLIER: "0.7",
      PW_PARRY_ENABLED: "0",
      PW_PARRY_CHANCE_BASE: "0.0",
      PW_BLOCK_ENABLED: "1",
      PW_BLOCK_CHANCE_BASE: "1.0",
      PW_BLOCK_MULTIPLIER: "0.5",
    },
    () =>
      computeDamage(
        src,
        tgt,
        {
          basePower: 100,
          forceBlock: true,
          rng: rand,
        }
      )
  );

  assert.equal(out.wasCrit, true);
  assert.equal(out.wasBlocked, true);
  assert.equal(out.wasParried, false);

  // basePower=100, roll=1.0 => 100
  // crit mult=2.0 => 200
  // block mult=0.5 => 100
  assert.equal(out.damage, 100);
});

test("[contract] CombatEngine: block/parry never apply to spells (even if enabled)", () => {
  const src = makeSource("spell");
  const tgt = makeTarget();

  const rand = rngSeq([0.5, 0.0, 0.0, 0.0]);

  const out = withEnv(
    {
      PW_PARRY_ENABLED: "1",
      PW_PARRY_CHANCE_BASE: "1.0",
      PW_BLOCK_ENABLED: "1",
      PW_BLOCK_CHANCE_BASE: "1.0",
    },
    () =>
      computeDamage(
        src,
        tgt,
        {
          basePower: 100,
          rng: rand,
        }
      )
  );

  assert.equal(out.wasParried, false);
  assert.equal(out.wasBlocked, false);
  assert.ok(out.damage > 0);
});
