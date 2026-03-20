//worldcore/test/contract_crusaderReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_CRUSADER_REFERENCE_KIT = [
  { spellId: "crusader_righteous_strike", minLevel: 1 },
  { spellId: "crusader_bleeding_wound", minLevel: 3 },
  { spellId: "crusader_minor_mend", minLevel: 5 },
  { spellId: "crusader_sun_guard", minLevel: 7 },
  { spellId: "crusader_judgment", minLevel: 9 },
] as const;

const BESPOKE_CRUSADER_CLASS_KIT = [
  "crusader_oathbound_strike",
  "crusader_sanctuary",
  "crusader_purging_vow",
  "crusader_fervor",
  "crusader_verdict",
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

test("crusader runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const crusaderKit = REFERENCE_CLASS_KITS_L1_10.crusader;
  assert.ok(Array.isArray(crusaderKit), "crusader reference kit must exist");

  const crusaderSpellEntries = crusaderKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    crusaderSpellEntries.length,
    CANONICAL_CRUSADER_REFERENCE_KIT.length,
    "crusader reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_CRUSADER_REFERENCE_KIT) {
    const entry = crusaderSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) =>
        kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `crusader reference kit must include ${expected.spellId}`);
    assert.equal(
      entry.minLevel,
      expected.minLevel,
      `${expected.spellId} must unlock at level ${expected.minLevel}`,
    );
    assert.equal(entry.classId, "crusader");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }
});

test("canonical crusader runtime spells exist in SPELLS and exclude bespoke crusader class-kit ids", () => {
  for (const expected of CANONICAL_CRUSADER_REFERENCE_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }

  const crusaderKit = REFERENCE_CLASS_KITS_L1_10.crusader;
  const crusaderSpellIds = crusaderKit
    .filter((entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> => entry.kind === "spell")
    .map((entry: Extract<ReferenceKitEntry, { kind: "spell" }>) => entry.spellId);

  for (const bespokeSpellId of BESPOKE_CRUSADER_CLASS_KIT) {
    assert.ok(
      !crusaderSpellIds.includes(bespokeSpellId),
      `crusader reference kit must not include bespoke class-kit spell ${bespokeSpellId}`,
    );
  }
});

test("crusader canonical spell ids stay aligned with reference spellkit seed", () => {
  const spellkitSeed = readRepoFile("infra/schema/056_seed_crusader_spellkit_L1_10.sql");

  for (const { spellId } of CANONICAL_CRUSADER_REFERENCE_KIT) {
    assert.match(
      spellkitSeed,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `056 crusader spellkit seed must reference ${spellId}`,
    );
    assertSeedContainsClassSpell(spellkitSeed, "crusader", spellId);
  }

  for (const bespokeSpellId of BESPOKE_CRUSADER_CLASS_KIT) {
    assert.doesNotMatch(
      spellkitSeed,
      new RegExp(`'${escapeRegex(bespokeSpellId)}'`, "m"),
      `056 crusader spellkit seed must not use bespoke class-kit spell ${bespokeSpellId}`,
    );
  }
});

test("crusader bespoke class-kit seed remains distinct from canonical reference spellkit", () => {
  const classkitSeed = readRepoFile("infra/schema/056_seed_crusader_class_kit_L1_10.sql");

  for (const bespokeSpellId of BESPOKE_CRUSADER_CLASS_KIT) {
    assert.match(
      classkitSeed,
      new RegExp(`'${escapeRegex(bespokeSpellId)}'`, "m"),
      `056 crusader class-kit seed must reference bespoke spell ${bespokeSpellId}`,
    );
    assertSeedContainsClassSpell(classkitSeed, "crusader", bespokeSpellId);
  }

  for (const { spellId } of CANONICAL_CRUSADER_REFERENCE_KIT) {
    assert.doesNotMatch(
      classkitSeed,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `056 crusader class-kit seed must stay distinct from canonical reference spell ${spellId}`,
    );
  }
});
