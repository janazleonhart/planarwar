// worldcore/test/contract_ranksCommand_sources.test.ts
//
// Contract: ranks sources <id>
// - Lists configured sources for each rank in the chain.
// - Env-configured boss drops are supported in tests via PW_RANK_BOSS_DROPS_JSON.

import assert from "node:assert/strict";
import test from "node:test";

import { SPELLS } from "../spells/SpellTypes";
import { ABILITIES } from "../abilities/AbilityTypes";
import { handleRanksCommand } from "../mud/commands/player/ranksCommand";

function makeTestCtx(character: any): any {
  return {
    session: { character },
    sessions: {} as any,
    guilds: {} as any,
  };
}

test("[contract] ranks sources <id>: shows boss drop sources across chain (env)", async () => {
  const oldBossDrops = process.env.PW_RANK_BOSS_DROPS_JSON;
  const oldQuestGrants = process.env.PW_RANK_QUEST_GRANTS_JSON;

  // Inject Rank-II defs for test.
  const oldSpell = (SPELLS as any).arcane_bolt_ii;
  const oldAbility = (ABILITIES as any).warrior_power_strike_ii;

  try {
    (SPELLS as any).arcane_bolt_ii = {
      id: "arcane_bolt_ii",
      name: "Arcane Bolt II",
      kind: "damage_single_npc",
      classId: "any",
      minLevel: 1,
      description: "Stronger bolt.",
      school: "arcane",
      resourceType: "mana",
      resourceCost: 10,
      cooldownMs: 2500,
      damageMultiplier: 1.2,
      flatBonus: 10,
      rankGroupId: "arcane_bolt",
      rank: 2,
    };

    (ABILITIES as any).warrior_power_strike_ii = {
      ...(ABILITIES as any).warrior_power_strike,
      id: "warrior_power_strike_ii",
      name: "Power Strike II",
      rankGroupId: "warrior_power_strike",
      rank: 2,
    };

    process.env.PW_RANK_BOSS_DROPS_JSON = JSON.stringify({
      spells: [{ npcProtoId: "boss_dummy_proto", spellId: "arcane_bolt_ii", chance: 0.25, source: "test" }],
      abilities: [{ npcProtoId: "boss_dummy_proto", abilityId: "warrior_power_strike_ii", chance: 0.1, source: "test" }],
    });

    process.env.PW_RANK_QUEST_GRANTS_JSON = JSON.stringify({
      spells: [{ questId: "q_test_arcane", questName: "Test Quest", spellId: "arcane_bolt_ii", source: "test" }],
      abilities: [],
    });

    const char: any = {
      userId: "u1",
      id: "c1",
      classId: "warrior",
      progression: {},
      spellbook: { known: { arcane_bolt: { learnedAt: 0 } }, pending: {} },
      abilities: { known: { warrior_power_strike: { learnedAt: 0 } }, pending: {} },
    };

    const ctx = makeTestCtx(char);

    const sOut = await handleRanksCommand(ctx, ["sources", "arcane_bolt"]);
    assert.match(sOut, /Sources for spell: Arcane Bolt \[arcane_bolt\]/);
    assert.match(sOut, /Rank 2: Arcane Bolt II \[arcane_bolt_ii\]/);
    assert.match(sOut, /Boss drops \(env\): boss_dummy_proto \(25%\)/);
    assert.match(sOut, /Quest rewards \(env\): Test Quest \(q_test_arcane\) \[test\]/);

    const aOut = await handleRanksCommand(ctx, ["sources", "warrior_power_strike"]);
    assert.match(aOut, /Sources for ability: Power Strike \[warrior_power_strike\]/);
    assert.match(aOut, /Rank 2: Power Strike II \[warrior_power_strike_ii\]/);
    assert.match(aOut, /Boss drops \(env\): boss_dummy_proto \(10%\)/);
  } finally {
    process.env.PW_RANK_BOSS_DROPS_JSON = oldBossDrops;
    process.env.PW_RANK_QUEST_GRANTS_JSON = oldQuestGrants;

    if (oldSpell === undefined) delete (SPELLS as any).arcane_bolt_ii;
    else (SPELLS as any).arcane_bolt_ii = oldSpell;

    if (oldAbility === undefined) delete (ABILITIES as any).warrior_power_strike_ii;
    else (ABILITIES as any).warrior_power_strike_ii = oldAbility;
  }
});
