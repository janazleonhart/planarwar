// worldcore/test/contract_hierophantReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_HIEROPHANT_KIT = [
  { spellId: "hierophant_thorn_bolt", minLevel: 1 },
  { spellId: "hierophant_entangling_vines", minLevel: 3 },
  { spellId: "hierophant_rejuvenation", minLevel: 5 },
  { spellId: "hierophant_barkskin", minLevel: 7 },
  { spellId: "hierophant_sunfire", minLevel: 9 },
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

test("hierophant runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const hierophantKit = REFERENCE_CLASS_KITS_L1_10.hierophant;
  assert.ok(Array.isArray(hierophantKit), "hierophant reference kit must exist");

  const hierophantSpellEntries = hierophantKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    hierophantSpellEntries.length,
    CANONICAL_HIEROPHANT_KIT.length,
    "hierophant reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_HIEROPHANT_KIT) {
    const entry = hierophantSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) =>
        kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `hierophant reference kit must include ${expected.spellId}`);
    assert.equal(
      entry.minLevel,
      expected.minLevel,
      `${expected.spellId} must unlock at level ${expected.minLevel}`,
    );
    assert.equal(entry.classId, "hierophant");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }
});

test("canonical hierophant runtime spells exist in SPELLS", () => {
  for (const expected of CANONICAL_HIEROPHANT_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }
});

test("hierophant bespoke spellkit seed stays aligned with canonical runtime truth", () => {
  const seed062 = readRepoFile("infra/schema/062_seed_hierophant_spellkit_L1_10.sql");

  for (const { spellId, minLevel } of CANONICAL_HIEROPHANT_KIT) {
    assert.match(
      seed062,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `062 must reference canonical hierophant spell ${spellId}`,
    );
    assert.match(
      seed062,
      new RegExp(`\\('hierophant'\\s*,\\s*'${escapeRegex(spellId)}'\\s*,\\s*${minLevel}\\s*,`, "m"),
      `062 must unlock ${spellId} for hierophant at level ${minLevel}`,
    );
  }
});
