// worldcore/test/contract_illusionistReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_ILLUSIONIST_KIT = [
  { spellId: "illusionist_mind_spike", minLevel: 1 },
  { spellId: "illusionist_snare", minLevel: 3 },
  { spellId: "illusionist_mesmerize", minLevel: 5 },
  { spellId: "illusionist_mirror_image", minLevel: 7 },
  { spellId: "illusionist_phantasmal_burn", minLevel: 9 },
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

test("illusionist runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const illusionistKit = REFERENCE_CLASS_KITS_L1_10.illusionist;
  assert.ok(Array.isArray(illusionistKit), "illusionist reference kit must exist");

  const illusionistSpellEntries = illusionistKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    illusionistSpellEntries.length,
    CANONICAL_ILLUSIONIST_KIT.length,
    "illusionist reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_ILLUSIONIST_KIT) {
    const entry = illusionistSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) =>
        kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `illusionist reference kit must include ${expected.spellId}`);
    assert.equal(
      entry.minLevel,
      expected.minLevel,
      `${expected.spellId} must unlock at level ${expected.minLevel}`,
    );
    assert.equal(entry.classId, "illusionist");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }
});

test("canonical illusionist runtime spells exist in SPELLS", () => {
  for (const expected of CANONICAL_ILLUSIONIST_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }
});

test("illusionist bespoke spellkit seed stays aligned with canonical runtime truth", () => {
  const seed059 = readRepoFile("infra/schema/059_seed_illusionist_spellkit_L1_10.sql");

  for (const { spellId, minLevel } of CANONICAL_ILLUSIONIST_KIT) {
    assert.match(
      seed059,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `059 must reference canonical illusionist spell ${spellId}`,
    );
    assert.match(
      seed059,
      new RegExp(`\\('illusionist'\\s*,\\s*'${escapeRegex(spellId)}'\\s*,\\s*${minLevel}\\s*,`, "m"),
      `059 must unlock ${spellId} for illusionist at level ${minLevel}`,
    );
  }
});
