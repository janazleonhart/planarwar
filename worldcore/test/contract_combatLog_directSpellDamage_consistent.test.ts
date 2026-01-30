// worldcore/test/contract_combatLog_directSpellDamage_consistent.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  formatWorldSpellDirectDamageLine,
  formatWorldSpellDotTickLine,
  formatWorldSpellHotTickLine,
} from "../combat/CombatLog";

test("[contract] CombatLog: direct spell damage line format matches DOT/HOT tick style", () => {
  const direct = formatWorldSpellDirectDamageLine({
    spellName: "Arcane Bolt",
    targetName: "Sturdy Training Dummy",
    damage: 688,
    hpAfter: 7708,
    maxHp: 10000,
  });

  assert.equal(
    direct,
    "[world] [spell:Arcane Bolt] You hit Sturdy Training Dummy for 688 damage. (7708/10000 HP)",
  );

  const directOverkill = formatWorldSpellDirectDamageLine({
    spellName: "Arcane Bolt",
    targetName: "Sturdy Training Dummy",
    damage: 688,
    overkill: 12,
    hpAfter: 0,
    maxHp: 10000,
  });

  assert.equal(
    directOverkill,
    "[world] [spell:Arcane Bolt] You hit Sturdy Training Dummy for 688 damage (12 overkill). (0/10000 HP)",
  );

  const dot = formatWorldSpellDotTickLine({
    spellName: "Ignite",
    targetName: "Sturdy Training Dummy",
    damage: 210,
    hpAfter: 9160,
    maxHp: 10000,
  });

  const hot = formatWorldSpellHotTickLine({
    spellName: "Regeneration",
    targetName: "Rimuru",
    heal: 55,
    hpAfter: 90,
    maxHp: 100,
  });

  // Prefix style must match across direct/DOT/HOT.
  for (const line of [direct, dot, hot]) {
    assert.ok(
      line.startsWith("[world] [spell:"),
      `expected canonical prefix, got: ${line}`,
    );
  }
});
