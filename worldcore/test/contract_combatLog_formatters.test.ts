// worldcore/test/contract_combatLog_formatters.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  formatWorldSpellDotTickLine,
  formatWorldSpellHotTickLine,
} from "../combat/CombatLog";

test("[contract] CombatLog DOT/HOT tick line format is stable", () => {
  const dot = formatWorldSpellDotTickLine({
    spellName: "Ignite",
    targetName: "Sturdy Training Dummy",
    damage: 210,
    hpAfter: 9790,
    maxHp: 10000,
  });

  assert.equal(
    dot,
    "[world] [spell:Ignite] Ignite deals 210 damage to Sturdy Training Dummy. (9790/10000 HP)",
  );

  const hot = formatWorldSpellHotTickLine({
    spellName: "Regen",
    targetName: "Tester",
    heal: 42,
    hpAfter: 100,
    maxHp: 100,
  });

  assert.equal(
    hot,
    "[world] [spell:Regen] Regen restores 42 health to Tester. (100/100 HP)",
  );

  // HP part is optional.
  assert.equal(
    formatWorldSpellDotTickLine({
      spellName: "Ignite",
      targetName: "Dummy",
      damage: 1,
    }),
    "[world] [spell:Ignite] Ignite deals 1 damage to Dummy.",
  );
});

test("[contract] TickEngine emits DOT tick lines via CombatLog formatter", () => {
  // This is a lightweight guardrail: we want TickEngine to keep using the shared
  // formatter so UI log shapes don't drift.
  const p = path.join(__dirname, "..", "core", "TickEngine.js");
  const src = fs.readFileSync(p, "utf8");
  assert.ok(
    src.includes("formatWorldSpellDotTickLine"),
    "TickEngine should call formatWorldSpellDotTickLine (centralized combat log)",
  );
});
