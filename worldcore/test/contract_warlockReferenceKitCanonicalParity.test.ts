// worldcore/test/contract_warlockReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_WARLOCK_KIT = [
  { spellId: "warlock_shadow_bolt", minLevel: 1 },
  { spellId: "warlock_siphon_life", minLevel: 3 },
  { spellId: "warlock_drain_soul", minLevel: 5 },
  { spellId: "warlock_unholy_brand", minLevel: 7 },
  { spellId: "warlock_demon_skin", minLevel: 9 },
] as const;

const STALE_WARLOCK_IDS = [
  "warlock_weakening_curse",
  "warlock_corruption",
  "warlock_demonic_barrier",
  "warlock_soul_siphon",
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

test("warlock runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const warlockKit = REFERENCE_CLASS_KITS_L1_10.warlock;
  assert.ok(Array.isArray(warlockKit), "warlock reference kit must exist");

  const warlockSpellEntries = warlockKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    warlockSpellEntries.length,
    CANONICAL_WARLOCK_KIT.length,
    "warlock reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_WARLOCK_KIT) {
    const entry = warlockSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) => kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `warlock reference kit must include ${expected.spellId}`);
    assert.equal(entry.minLevel, expected.minLevel, `${expected.spellId} must unlock at level ${expected.minLevel}`);
    assert.equal(entry.classId, "warlock");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }

  for (const staleSpellId of STALE_WARLOCK_IDS) {
    assert.ok(
      !warlockSpellEntries.some(
        (entry: Extract<ReferenceKitEntry, { kind: "spell" }>) => entry.spellId === staleSpellId,
      ),
      `warlock reference kit must not include stale spell ${staleSpellId}`,
    );
  }
});

test("canonical warlock runtime spells exist in SPELLS and stale ids do not appear in reference kit", () => {
  for (const expected of CANONICAL_WARLOCK_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }

  const warlockKit = REFERENCE_CLASS_KITS_L1_10.warlock;
  const warlockSpellIds = warlockKit
    .filter((entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> => entry.kind === "spell")
    .map((entry: Extract<ReferenceKitEntry, { kind: "spell" }>) => entry.spellId);

  for (const staleSpellId of STALE_WARLOCK_IDS) {
    assert.ok(!warlockSpellIds.includes(staleSpellId), `reference kit must not include stale spell ${staleSpellId}`);
  }
});

test("warlock canonical spell ids stay aligned across reference seeds and mapped-class seeds", () => {
  const seed050 = readRepoFile("infra/schema/050_seed_reference_class_kits_L1_10.sql");
  const seed051 = readRepoFile("infra/schema/051_seed_spell_unlocks_reference_kits_l1_10.sql");
  const seed055 = readRepoFile("infra/schema/055_seed_wave1_class_kit_mappings_L1_10.sql");
  const seed056 = readRepoFile("infra/schema/056_fix_wave1_mapped_spells_class_any.sql");

  for (const { spellId } of CANONICAL_WARLOCK_KIT) {
    assert.match(seed050, new RegExp(`'${escapeRegex(spellId)}'`), `050 must reference ${spellId}`);
    assertSeedContainsClassSpell(seed051, "warlock", spellId);
    assertSeedContainsClassSpell(seed055, "revenant", spellId);
    assertSeedContainsClassSpell(seed055, "defiler", spellId);
    assert.match(seed056, new RegExp(`'${escapeRegex(spellId)}'`, "m"), `056 must reference ${spellId}`);
  }

  for (const staleSpellId of STALE_WARLOCK_IDS) {
    assert.doesNotMatch(seed050, new RegExp(`'${escapeRegex(staleSpellId)}'`), `050 must not reference stale spell ${staleSpellId}`);
    assertSeedOmitsClassSpell(seed051, "warlock", staleSpellId);
    assertSeedOmitsClassSpell(seed055, "revenant", staleSpellId);
    assertSeedOmitsClassSpell(seed055, "defiler", staleSpellId);
    assert.doesNotMatch(seed056, new RegExp(`'${escapeRegex(staleSpellId)}'`, "m"), `056 must not reference stale spell ${staleSpellId}`);
  }
});