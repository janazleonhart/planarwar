//worldcore/test/contract_outriderReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_OUTRIDER_KIT = [
  { spellId: "outrider_quick_shot", minLevel: 1 },
  { spellId: "outrider_barbed_arrow", minLevel: 3 },
  { spellId: "outrider_mark_prey", minLevel: 5 },
  { spellId: "outrider_evasive_roll", minLevel: 7 },
  { spellId: "outrider_aimed_shot", minLevel: 9 },
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

test("outrider runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const outriderKit = REFERENCE_CLASS_KITS_L1_10.outrider;
  assert.ok(Array.isArray(outriderKit), "outrider reference kit must exist");

  const outriderSpellEntries = outriderKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    outriderSpellEntries.length,
    CANONICAL_OUTRIDER_KIT.length,
    "outrider reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_OUTRIDER_KIT) {
    const entry = outriderSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) =>
        kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `outrider reference kit must include ${expected.spellId}`);
    assert.equal(
      entry.minLevel,
      expected.minLevel,
      `${expected.spellId} must unlock at level ${expected.minLevel}`,
    );
    assert.equal(entry.classId, "outrider");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }
});

test("canonical outrider runtime spells exist in SPELLS", () => {
  for (const expected of CANONICAL_OUTRIDER_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }
});

test("outrider bespoke spellkit seed stays aligned with canonical runtime truth", () => {
  const seed064 = readRepoFile("infra/schema/064_seed_outrider_spellkit_L1_10.sql");

  for (const { spellId, minLevel } of CANONICAL_OUTRIDER_KIT) {
    assert.match(
      seed064,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `064 must reference canonical outrider spell ${spellId}`,
    );
    assert.match(
      seed064,
      new RegExp(`\\('outrider'\\s*,\\s*'${escapeRegex(spellId)}'\\s*,\\s*${minLevel}\\s*,`, "m"),
      `064 must unlock ${spellId} for outrider at level ${minLevel}`,
    );
  }
});
