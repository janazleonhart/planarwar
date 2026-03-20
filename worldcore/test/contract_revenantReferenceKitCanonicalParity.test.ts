//worldcore/test/contract_revenantReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_REVENANT_KIT = [
  { spellId: "revenant_shadow_slash", minLevel: 1 },
  { spellId: "revenant_deathly_miasma", minLevel: 3 },
  { spellId: "revenant_soul_siphon", minLevel: 5 },
  { spellId: "revenant_dark_ward", minLevel: 7 },
  { spellId: "revenant_dread_presence", minLevel: 9 },
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

test("revenant runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const revenantKit = REFERENCE_CLASS_KITS_L1_10.revenant;
  assert.ok(Array.isArray(revenantKit), "revenant reference kit must exist");

  const revenantSpellEntries = revenantKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    revenantSpellEntries.length,
    CANONICAL_REVENANT_KIT.length,
    "revenant reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_REVENANT_KIT) {
    const entry = revenantSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) => kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `revenant reference kit must include ${expected.spellId}`);
    assert.equal(entry.minLevel, expected.minLevel, `${expected.spellId} must unlock at level ${expected.minLevel}`);
    assert.equal(entry.classId, "revenant");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }
});

test("canonical revenant runtime spells exist in SPELLS", () => {
  for (const expected of CANONICAL_REVENANT_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }
});

test("revenant canonical spell ids stay aligned with bespoke spellkit seed", () => {
  const seed063 = readRepoFile("infra/schema/063_seed_revenant_spellkit_L1_10.sql");

  for (const { spellId } of CANONICAL_REVENANT_KIT) {
    assert.match(
      seed063,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `063 revenant spellkit seed must reference ${spellId}`,
    );
    assertSeedContainsClassSpell(seed063, "revenant", spellId);
  }
});
