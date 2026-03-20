// worldcore/test/contract_templarReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_TEMPLAR_KIT = [
  { spellId: "templar_restorative_prayer", minLevel: 1 },
  { spellId: "templar_smite", minLevel: 3 },
  { spellId: "templar_minor_cleanse", minLevel: 5 },
  { spellId: "templar_aegis_of_light", minLevel: 7 },
  { spellId: "templar_judgment", minLevel: 9 },
] as const;

const MAPPED_TEMPLAR_CLASSES = ["hierophant", "ascetic", "prophet"] as const;

function resolveRepoPath(relativePath: string): string {
  const candidates = [
    path.resolve(__dirname, "..", relativePath),
    path.resolve(__dirname, "../..", "worldcore", relativePath),
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), "worldcore", relativePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Unable to locate ${relativePath} from ${__dirname}`);
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(resolveRepoPath(relativePath), "utf8");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSeedContainsClassSpell(seedSql: string, classId: string, spellId: string): void {
  assert.match(
    seedSql,
    new RegExp(`\\('${escapeRegex(classId)}'\\s*,\\s*'${escapeRegex(spellId)}'\\s*,`, "m"),
    `${classId} seed must include ${spellId}`,
  );
}

test("templar runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const templarKit = REFERENCE_CLASS_KITS_L1_10.templar;
  assert.ok(Array.isArray(templarKit), "templar reference kit must exist");

  const templarSpellEntries = templarKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    templarSpellEntries.length,
    CANONICAL_TEMPLAR_KIT.length,
    "templar reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_TEMPLAR_KIT) {
    const entry = templarSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) => kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `templar reference kit must include ${expected.spellId}`);
    assert.equal(entry.minLevel, expected.minLevel, `${expected.spellId} must unlock at level ${expected.minLevel}`);
    assert.equal(entry.classId, "templar");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
    assert.ok(SPELLS[expected.spellId], `${expected.spellId} must exist in SPELLS`);
  }
});

test("templar canonical spell ids stay aligned across reference seeds and mapped-class seeds", () => {
  const seed050 = readRepoFile("infra/schema/050_seed_reference_class_kits_L1_10.sql");
  const seed051 = readRepoFile("infra/schema/051_seed_spell_unlocks_reference_kits_l1_10.sql");
  const seed055 = readRepoFile("infra/schema/055_seed_wave1_class_kit_mappings_L1_10.sql");
  const seed056 = readRepoFile("infra/schema/056_fix_wave1_mapped_spells_class_any.sql");

  for (const { spellId } of CANONICAL_TEMPLAR_KIT) {
    assert.match(seed050, new RegExp(`'${escapeRegex(spellId)}'`), `050 must reference ${spellId}`);
    assertSeedContainsClassSpell(seed051, "templar", spellId);
    for (const mappedClass of MAPPED_TEMPLAR_CLASSES) {
      assertSeedContainsClassSpell(seed055, mappedClass, spellId);
    }
    assert.match(seed056, new RegExp(`'${escapeRegex(spellId)}'`, "m"), `056 must reference ${spellId}`);
  }
});
