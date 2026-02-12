// worldcore/test/contract_trainCommand_preview.test.ts
//
// Contract: train preview
// - train preview spells shows blocked reasons (e.g., level too low)
// - train preview abilities shows blocked reasons (e.g., level too low)

import test from "node:test";
import assert from "node:assert/strict";

import { defaultSpellbook, defaultAbilities } from "../characters/CharacterTypes";
import { ABILITIES } from "../abilities/AbilityTypes";
import { grantSpellInState } from "../spells/SpellLearning";
import { grantAbilityInState } from "../abilities/AbilityLearning";
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickWarriorAbilityMinLevelAtLeast(minLevel: number): string {
  const ability = Object.values(ABILITIES).find(
    (a: any) => String(a?.classId ?? "").toLowerCase() === "warrior" && Number(a?.minLevel ?? 1) >= minLevel,
  ) as any;

  assert.ok(ability && ability.id, `Expected at least one warrior ability with minLevel>=${minLevel} in ABILITIES.`);
  return String(ability.id);
}

test("[contract] train preview spells: blocked reasons show (level too low)", async () => {
  const old = process.env.WORLDCORE_TEST;
  process.env.WORLDCORE_TEST = "1";

  try {
    // Virtuoso has a fallback unlock at minLevel 5 for this spell/song.
    const c0 = mkChar("virtuoso", 1);
    const g = grantSpellInState(c0 as any, "virtuoso_dissonant_battle_chant", "test", 111);
    assert.equal(g.ok, true);

    const ctx = makeCtx((g as any).next);
    const out = await handleTrainCommand(ctx as any, ["preview", "spells"]);

    assert.match(out, /Spells blocked:/);
    assert.match(out, /\(virtuoso_dissonant_battle_chant\): level too low/);
  } finally {
    process.env.WORLDCORE_TEST = old;
  }
});

test("[contract] train preview abilities: blocked reasons show (level too low)", async () => {
  const old = process.env.WORLDCORE_TEST;
  process.env.WORLDCORE_TEST = "1";

  try {
    const abilityId = pickWarriorAbilityMinLevelAtLeast(3);

    const c0 = mkChar("warrior", 1);
    const g = grantAbilityInState(c0 as any, abilityId, "test", 111);
    assert.equal(g.ok, true);

    const ctx = makeCtx((g as any).next);
    const out = await handleTrainCommand(ctx as any, ["preview", "abilities"]);

    assert.match(out, /Abilities blocked:/);
    assert.match(out, new RegExp(`\\(${escapeRegex(abilityId)}\\): level too low`));
  } finally {
    process.env.WORLDCORE_TEST = old;
  }
});
