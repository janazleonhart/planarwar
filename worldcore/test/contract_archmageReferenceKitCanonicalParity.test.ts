// worldcore/test/contract_archmageReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_ARCHMAGE_KIT = [
  { spellId: "archmage_arcane_bolt", minLevel: 1 },
  { spellId: "archmage_expose_arcana", minLevel: 3 },
  { spellId: "archmage_mana_shield", minLevel: 5 },
  { spellId: "archmage_ignite", minLevel: 7 },
  { spellId: "archmage_purge_hex", minLevel: 9 },
] as const;

const STALE_ARCHMAGE_IDS = [
  "archmage_arcane_missiles",
] as const;

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

function assertSeedOmitsClassSpell(seedSql: string, classId: string, spellId: string): void {
  assert.doesNotMatch(
    seedSql,
    new RegExp(`\\('${escapeRegex(classId)}'\\s*,\\s*'${escapeRegex(spellId)}'\\s*,`, "m"),
    `${classId} seed must not include stale spell ${spellId}`,
  );
}

test("archmage runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const archmageKit = REFERENCE_CLASS_KITS_L1_10.archmage;
  assert.ok(Array.isArray(archmageKit), "archmage reference kit must exist");

  const archmageSpellEntries = archmageKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    archmageSpellEntries.length,
    CANONICAL_ARCHMAGE_KIT.length,
    "archmage reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_ARCHMAGE_KIT) {
    const entry = archmageSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) => kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `archmage reference kit must include ${expected.spellId}`);
    assert.equal(entry.minLevel, expected.minLevel, `${expected.spellId} must unlock at level ${expected.minLevel}`);
    assert.equal(entry.classId, "archmage");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }

  for (const staleSpellId of STALE_ARCHMAGE_IDS) {
    assert.ok(
      !archmageSpellEntries.some(
        (entry: Extract<ReferenceKitEntry, { kind: "spell" }>) => entry.spellId === staleSpellId,
      ),
      `archmage reference kit must not include stale spell ${staleSpellId}`,
    );
  }
});

test("canonical archmage runtime spells exist in SPELLS and stale ids do not appear in reference kit", () => {
  for (const expected of CANONICAL_ARCHMAGE_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }

  const archmageKit = REFERENCE_CLASS_KITS_L1_10.archmage;
  const archmageSpellIds = archmageKit
    .filter((entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> => entry.kind === "spell")
    .map((entry: Extract<ReferenceKitEntry, { kind: "spell" }>) => entry.spellId);

  for (const staleSpellId of STALE_ARCHMAGE_IDS) {
    assert.ok(!archmageSpellIds.includes(staleSpellId), `reference kit must not include stale spell ${staleSpellId}`);
  }
});

test("archmage canonical spell ids stay aligned across reference seeds and mapped-class seeds", () => {
  const seed050 = readRepoFile("infra/schema/050_seed_reference_class_kits_L1_10.sql");
  const seed051 = readRepoFile("infra/schema/051_seed_spell_unlocks_reference_kits_l1_10.sql");
  const seed055 = readRepoFile("infra/schema/055_seed_wave1_class_kit_mappings_L1_10.sql");
  const seed056 = readRepoFile("infra/schema/056_fix_wave1_mapped_spells_class_any.sql");

  for (const { spellId } of CANONICAL_ARCHMAGE_KIT) {
    assert.match(seed050, new RegExp(`'${escapeRegex(spellId)}'`), `050 must reference ${spellId}`);
    assertSeedContainsClassSpell(seed051, "archmage", spellId);
    assertSeedContainsClassSpell(seed055, "illusionist", spellId);
    assertSeedContainsClassSpell(seed055, "conjuror", spellId);
    assertSeedContainsClassSpell(seed055, "primalist", spellId);
    assert.match(seed056, new RegExp(`'${escapeRegex(spellId)}'`, "m"), `056 must reference ${spellId}`);
  }

  for (const staleSpellId of STALE_ARCHMAGE_IDS) {
    assert.doesNotMatch(seed050, new RegExp(`'${escapeRegex(staleSpellId)}'`), `050 must not reference stale spell ${staleSpellId}`);
    assertSeedOmitsClassSpell(seed051, "archmage", staleSpellId);
    assertSeedOmitsClassSpell(seed055, "illusionist", staleSpellId);
    assertSeedOmitsClassSpell(seed055, "conjuror", staleSpellId);
    assertSeedOmitsClassSpell(seed055, "primalist", staleSpellId);
    assert.doesNotMatch(seed056, new RegExp(`'${escapeRegex(staleSpellId)}'`, "m"), `056 must not reference stale spell ${staleSpellId}`);
  }
});
