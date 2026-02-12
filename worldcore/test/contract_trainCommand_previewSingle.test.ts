// worldcore/test/contract_trainCommand_previewSingle.test.ts
//
// Contract: train preview <id>
// - single-target preview shows status + blocked reason with required level when available.

import test from "node:test";
import assert from "node:assert/strict";

import { defaultSpellbook, defaultAbilities } from "../characters/CharacterTypes";
import { grantSpellInState } from "../spells/SpellLearning";
import { handleTrainCommand } from "../mud/commands/player/trainCommand";

function makeCtx(character: any): any {
  return {
    session: { character },
    sessions: {} as any,
    guilds: {} as any,
    characters: {} as any, // preview does not call characters.service methods
  };
}

function mkChar(classId: string, level = 1): any {
  return {
    id: "c1",
    userId: "u1",
    name: "Test",
    classId,
    level,
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
  };
}

test("[contract] train preview <id>: single-target shows status + required level", async () => {
  const old = process.env.WORLDCORE_TEST;
  process.env.WORLDCORE_TEST = "1";

  try {
    // This spell is unlock-gated in test/db source (minLevel 5 for Virtuoso in reference kits).
    const c0 = mkChar("virtuoso", 1);
    const g = grantSpellInState(c0 as any, "virtuoso_dissonant_battle_chant", "test", 111);
    assert.equal(g.ok, true);

    const ctx = makeCtx((g as any).next);
    const out = await handleTrainCommand(ctx as any, ["preview", "virtuoso_dissonant_battle_chant"]);

    assert.match(out, /Spell preview:/);
    assert.match(out, /Status: pending\./);
    assert.match(out, /Blocked: level too low \(requires level 5\)\./);
  } finally {
    process.env.WORLDCORE_TEST = old;
  }
});
