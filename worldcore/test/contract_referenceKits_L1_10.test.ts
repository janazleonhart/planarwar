// worldcore/test/contract_referenceKits_L1_10.test.ts
//
// “Architectural seatbelt”: reference kits must be internally consistent
// and must drive unlock/autogrant behavior in test mode.

import test from "node:test";
import assert from "node:assert/strict";

import { defaultSpellbook, defaultAbilities } from "../characters/CharacterTypes";
import { ensureSpellbookAutogrants } from "../spells/SpellTypes";
import { __setSpellUnlocksForTest, __resetSpellUnlocksForTest } from "../spells/SpellUnlocks";
import { __setAbilityUnlocksForTest, __resetAbilityUnlocksForTest } from "../abilities/AbilityUnlocks";
import { isAbilityKnownForChar } from "../abilities/AbilityLearning";

import { REFERENCE_CLASS_KITS_L1_10 } from "../spells/ReferenceKits";

function mkChar(classId: any, level: number): any {
  const spellbook = defaultSpellbook();

  // Some historical versions of CharacterTypes/defaultAbilities() did not
  // guarantee a `known` dictionary. The contract tests should be resilient:
  // we care about unlock/plumbing rules, not the shape of an unrelated default.
  const abilities = defaultAbilities() as any;
  if (!abilities.known || typeof abilities.known !== "object") abilities.known = {};

  return {
    id: "test.char",
    name: "Test Char",
    level,
    classId,
    spellbook,
    abilities,
    // minimal fields used by spell/ability unlock plumbing
    stats: { maxHp: 100, hp: 100, maxMp: 100, mp: 100 },
  };
}

/** Helper to avoid TS7053 / possibly-undefined when kits is a Partial record. */
function entriesFor(kits: any, classId: string): any[] {
  const list = kits?.[classId];
  return Array.isArray(list) ? list : [];
}

function assertAutograntsAllSpellsBy10(kits: any, classId: string): void {
  const c = mkChar(classId, 10);
  ensureSpellbookAutogrants(c);
  const known = Object.keys(c.spellbook.known ?? {});
  for (const e of entriesFor(kits, classId)) {
    if (e.kind !== "spell") continue;
    assert.ok(known.includes(String(e.spellId)), `${classId} should autogrant ${String(e.spellId)} by 10`);
  }
}

test("[contract] reference kits L1–10 are consistent + autogrant works in test mode", () => {
  const kits = REFERENCE_CLASS_KITS_L1_10 as any;

  // --- basic integrity ---
  for (const [classId, entries] of Object.entries(kits) as any[]) {
    if (!Array.isArray(entries) || entries.length === 0) continue;

    // Must include level 1
    assert.ok(entries.some((e: any) => e.minLevel === 1), `${classId} kit must include a level 1 entry`);

    // Must be within L1–10
    for (const e of entries) {
      assert.ok(e.minLevel >= 1 && e.minLevel <= 10, `${classId} entry out of range: ${JSON.stringify(e)}`);
    }

    // No duplicates for the same id
    const seen = new Set<string>();
    for (const e of entries) {
      const key = `${String(e.kind)}:${String(e.spellId ?? e.abilityId)}`;
      assert.ok(!seen.has(key), `${classId} kit contains duplicate entry: ${key}`);
      seen.add(key);
    }
  }

  // --- convert kits to unlock rules (snake_case, matching DB rows) ---
  const spellRules: any[] = [];
  const abilityRules: any[] = [];

  for (const [, entries] of Object.entries(kits) as any[]) {
    if (!Array.isArray(entries) || entries.length === 0) continue;

    for (const e of entries) {
      if (e.kind === "spell") {
        spellRules.push({
          class_id: e.classId,
          spell_id: e.spellId,
          min_level: e.minLevel,
          auto_grant: e.autoGrant,
          is_enabled: e.isEnabled,
          source: e.source,
        });
      } else {
        abilityRules.push({
          class_id: e.classId,
          ability_id: e.abilityId,
          min_level: e.minLevel,
          auto_grant: e.autoGrant,
          is_enabled: e.isEnabled,
          source: e.source,
        });
      }
    }
  }

  __setSpellUnlocksForTest(spellRules as any);
  __setAbilityUnlocksForTest(abilityRules as any);

  try {
    // Spell kits: by level 10 should know all kit spells
    assertAutograntsAllSpellsBy10(kits, "archmage");
    assertAutograntsAllSpellsBy10(kits, "warlock");
    assertAutograntsAllSpellsBy10(kits, "templar");
    assertAutograntsAllSpellsBy10(kits, "crusader");
    assertAutograntsAllSpellsBy10(kits, "revenant");
    assertAutograntsAllSpellsBy10(kits, "hunter");
    assertAutograntsAllSpellsBy10(kits, "runic_knight");
    assertAutograntsAllSpellsBy10(kits, "illusionist");
    assertAutograntsAllSpellsBy10(kits, "ascetic");
    assertAutograntsAllSpellsBy10(kits, "prophet");
    assertAutograntsAllSpellsBy10(kits, "hierophant");
    assertAutograntsAllSpellsBy10(kits, "outrider");

    // Warlord: ability learns by level (we only assert "known" lookup works when we simulate a learned entry)
    {
      const c = mkChar("warlord", 10);
      for (const e of entriesFor(kits, "warlord")) {
        if (e.kind !== "ability") continue;
        c.abilities.known[String(e.abilityId)] = { learnedAt: Date.now() };
        assert.ok(isAbilityKnownForChar(c, String(e.abilityId)), `warlord should treat ${String(e.abilityId)} as known`);
      }
    }
  } finally {
    __resetSpellUnlocksForTest();
    __resetAbilityUnlocksForTest();
  }
});