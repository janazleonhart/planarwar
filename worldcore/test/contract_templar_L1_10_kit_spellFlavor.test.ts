// worldcore/test/contract_templar_L1_10_kit_spellFlavor.test.ts
//
// Contract seatbelt: Templar must be a *real* playable reference-kit class.
// - All Templar kit spells must exist in the in-code fallback catalog (SPELLS)
// - They must have non-placeholder name/description flavor
// - Autogrant at level 10 must grant the full kit in WORLDCORE_TEST mode

import test from "node:test";
import assert from "node:assert/strict";

import { defaultSpellbook, defaultAbilities } from "../characters/CharacterTypes";
import { SPELLS, ensureSpellbookAutogrants } from "../spells/SpellTypes";
import { __setSpellUnlocksForTest, __resetSpellUnlocksForTest } from "../spells/SpellUnlocks";
import { REFERENCE_CLASS_KITS_L1_10 } from "../spells/ReferenceKits";

function mkChar(classId: any, level: number): any {
  const spellbook = defaultSpellbook();

  const abilities = defaultAbilities() as any;
  if (!abilities.known || typeof abilities.known !== "object") abilities.known = {};

  return {
    id: "test.templar",
    name: "Test Templar",
    level,
    classId,
    spellbook,
    abilities,
    stats: { maxHp: 100, hp: 100, maxMp: 100, mp: 100 },
  };
}

function entriesFor(kits: any, classId: string): any[] {
  const list = kits?.[classId];
  return Array.isArray(list) ? list : [];
}

function assertHasFlavor(spellId: string) {
  const def = (SPELLS as any)[spellId];
  assert.ok(def, `templar kit spell must exist in SPELLS fallback: ${spellId}`);

  const name = String(def.name ?? "").trim();
  const desc = String(def.description ?? "").trim();

  assert.ok(name.length >= 4, `${spellId} must have a non-empty name`);
  assert.ok(desc.length >= 12, `${spellId} must have a non-empty description`);

  const upper = (name + " " + desc).toUpperCase();
  assert.ok(!upper.includes("TODO"), `${spellId} flavor must not contain TODO`);
  assert.ok(!upper.includes("PLACEHOLDER"), `${spellId} flavor must not contain PLACEHOLDER`);
  assert.ok(!upper.includes("TBD"), `${spellId} flavor must not contain TBD`);
}

test("[contract] templar L1–10 reference kit is playable + has flavor", () => {
  const kits = REFERENCE_CLASS_KITS_L1_10 as any;
  const templar = entriesFor(kits, "templar");

  // Templar should not be an empty placeholder.
  assert.ok(Array.isArray(templar) && templar.length > 0, "templar kit must exist and be non-empty");

  // Must include a level 1 entry.
  assert.ok(templar.some((e: any) => e.minLevel === 1), "templar kit must include a level 1 entry");

  // Build unlock rules ONLY for templar (keeps the contract tight).
  const spellRules: any[] = [];
  for (const e of templar) {
    assert.equal(e.kind, "spell", `templar kit should only contain spells (got ${String(e.kind)})`);
    spellRules.push({
      class_id: e.classId,
      spell_id: e.spellId,
      min_level: e.minLevel,
      auto_grant: e.autoGrant,
      is_enabled: e.isEnabled,
      source: e.source,
    });

    // Existence + flavor
    assertHasFlavor(String(e.spellId));

    // Optional sanity: defs should be class-gated correctly
    const def = (SPELLS as any)[String(e.spellId)];
    assert.equal(String(def.classId ?? ""), "templar", `${String(e.spellId)} must be classId=templar in SPELLS`);
  }

  __setSpellUnlocksForTest(spellRules as any);

  try {
    const c = mkChar("templar", 10);
    ensureSpellbookAutogrants(c);

    const known = Object.keys(c.spellbook.known ?? {});
    for (const e of templar) {
      assert.ok(known.includes(String(e.spellId)), `templar should autogrant ${String(e.spellId)} by 10`);
    }
  } finally {
    __resetSpellUnlocksForTest();
  }
});
