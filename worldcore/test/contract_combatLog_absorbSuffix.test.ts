// worldcore/test/contract_combatLog_absorbSuffix.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  formatWorldSpellDirectDamageLine,
  formatWorldSpellDotTickLine,
} from "../combat/CombatLog";

test("[contract] CombatLog: absorbed damage is explicitly annotated in direct + DOT lines", () => {
  const prev = process.env.PW_COMBAT_LOG_ABSORB_BREAKDOWN;
  process.env.PW_COMBAT_LOG_ABSORB_BREAKDOWN = "1";

  try {
  const directAbsorb = formatWorldSpellDirectDamageLine({
    spellName: "Arcane Bolt",
    targetName: "Sturdy Training Dummy",
    damage: 10,
    absorbed: 8,
    hpAfter: 9990,
    maxHp: 10000,
  });

  assert.equal(
    directAbsorb,
    "[world] [spell:Arcane Bolt] You hit Sturdy Training Dummy for 10 damage (8 absorbed). (9990/10000 HP)",
  );

  const directAbsorbBreakdown = formatWorldSpellDirectDamageLine({
    spellName: "Arcane Bolt",
    targetName: "Sturdy Training Dummy",
    damage: 10,
    absorbed: 8,
    absorbBreakdown: [
      { name: "Ward", priority: 2, absorbed: 5 },
      { name: "Barrier", priority: 1, absorbed: 3 },
    ],
    hpAfter: 9990,
    maxHp: 10000,
  });

  assert.equal(
    directAbsorbBreakdown,
    "[world] [spell:Arcane Bolt] You hit Sturdy Training Dummy for 10 damage (8 absorbed by Ward[p2]=5 > Barrier[p1]=3). (9990/10000 HP)",
  );

  const directAbsorbOverkill = formatWorldSpellDirectDamageLine({
    spellName: "Arcane Bolt",
    targetName: "Sturdy Training Dummy",
    damage: 10,
    absorbed: 8,
    overkill: 2,
    hpAfter: 0,
    maxHp: 10,
  });

  assert.equal(
    directAbsorbOverkill,
    "[world] [spell:Arcane Bolt] You hit Sturdy Training Dummy for 10 damage (8 absorbed, 2 overkill). (0/10 HP)",
  );

  const dotAbsorb = formatWorldSpellDotTickLine({
    spellName: "Ignite",
    targetName: "Sturdy Training Dummy",
    damage: 0,
    absorbed: 5,
    hpAfter: 10000,
    maxHp: 10000,
  });

  assert.equal(
    dotAbsorb,
    "[world] [spell:Ignite] Ignite deals 0 damage (5 absorbed) to Sturdy Training Dummy. (10000/10000 HP)",
  );
  } finally {
    if (prev === undefined) delete process.env.PW_COMBAT_LOG_ABSORB_BREAKDOWN;
    else process.env.PW_COMBAT_LOG_ABSORB_BREAKDOWN = prev;
  }
});
