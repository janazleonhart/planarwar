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

import { getAllClassDefinitions } from "../classes/ClassDefinitions";
import { getReferenceKitEntriesForClass } from "../spells/ReferenceKits";

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

test("[contract] reference kits L1–10: every class has a kit and autogrant works in test mode", () => {
  const classIds = (getAllClassDefinitions() as any[])
    .map((d) => String(d?.id ?? d?.classId ?? ""))
    .filter(Boolean);
  assert.ok(classIds.length > 0, "expected at least one class definition");

  // --- build kits for every class (includes fallback kit) ---
  const kitsByClass: Record<string, any[]> = {};
  for (const classId of classIds) {
    kitsByClass[classId] = getReferenceKitEntriesForClass(classId as any) as any[];
  }

  // --- basic integrity ---
  for (const [classId, entries] of Object.entries(kitsByClass)) {
    assert.ok(Array.isArray(entries) && entries.length > 0, `${classId} must have at least one reference kit entry (explicit or fallback)`);

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

  for (const [classId, entries] of Object.entries(kitsByClass)) {
    for (const e of entries) {
      if (e.kind === "spell") {
        spellRules.push({
          class_id: classId,
          spell_id: e.spellId,
          min_level: e.minLevel,
          auto_grant: e.autoGrant,
          is_enabled: e.isEnabled,
          source: e.source,
        });
      } else {
        abilityRules.push({
          class_id: classId,
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
    // All classes: by level 10 should know all kit spells (if any)
    for (const classId of classIds) {
      const entries = kitsByClass[classId] ?? [];
      const spellEntries = entries.filter((e: any) => e.kind === "spell");
      if (spellEntries.length === 0) continue;

      const c = mkChar(classId, 10);
      ensureSpellbookAutogrants(c);
      const known = Object.keys(c.spellbook.known ?? {});
      for (const e of spellEntries) {
        assert.ok(known.includes(String(e.spellId)), `${classId} should autogrant ${String(e.spellId)} by 10`);
      }
    }

    // Warlord: ability learns by level (sanity check that known lookup works)
    {
      const c = mkChar("warlord", 10);
      const entries = kitsByClass["warlord"] ?? [];
      for (const e of entries) {
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
