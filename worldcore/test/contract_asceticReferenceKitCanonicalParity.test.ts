// worldcore/test/contract_asceticReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_ASCETIC_KIT = [
  { spellId: "ascetic_jab", minLevel: 1 },
  { spellId: "ascetic_tiger_palm", minLevel: 3 },
  { spellId: "ascetic_crippling_strike", minLevel: 5 },
  { spellId: "ascetic_flying_kick", minLevel: 7 },
  { spellId: "ascetic_inner_focus", minLevel: 9 },
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

test("ascetic runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const asceticKit = REFERENCE_CLASS_KITS_L1_10.ascetic;
  assert.ok(Array.isArray(asceticKit), "ascetic reference kit must exist");

  const asceticSpellEntries = asceticKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    asceticSpellEntries.length,
    CANONICAL_ASCETIC_KIT.length,
    "ascetic reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_ASCETIC_KIT) {
    const entry = asceticSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) =>
        kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `ascetic reference kit must include ${expected.spellId}`);
    assert.equal(
      entry.minLevel,
      expected.minLevel,
      `${expected.spellId} must unlock at level ${expected.minLevel}`,
    );
    assert.equal(entry.classId, "ascetic");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }
});

test("canonical ascetic runtime spells exist in SPELLS", () => {
  for (const expected of CANONICAL_ASCETIC_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }
});

test("ascetic bespoke spellkit seed stays aligned with canonical runtime truth", () => {
  const seed060 = readRepoFile("infra/schema/060_seed_ascetic_spellkit_L1_10.sql");

  for (const { spellId, minLevel } of CANONICAL_ASCETIC_KIT) {
    assert.match(
      seed060,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `060 must reference canonical ascetic spell ${spellId}`,
    );
    assert.match(
      seed060,
      new RegExp(`\\('ascetic'\\s*,\\s*'${escapeRegex(spellId)}'\\s*,\\s*${minLevel}\\s*,`, "m"),
      `060 must unlock ${spellId} for ascetic at level ${minLevel}`,
    );
  }
});
