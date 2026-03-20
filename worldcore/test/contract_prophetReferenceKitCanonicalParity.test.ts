// worldcore/test/contract_prophetReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_PROPHET_KIT = [
  { spellId: "prophet_lightning_bolt", minLevel: 1 },
  { spellId: "prophet_flame_shock", minLevel: 3 },
  { spellId: "prophet_earth_shield", minLevel: 5 },
  { spellId: "prophet_ancestral_vigor", minLevel: 7 },
  { spellId: "prophet_healing_wave", minLevel: 9 },
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

test("prophet runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const prophetKit = REFERENCE_CLASS_KITS_L1_10.prophet;
  assert.ok(Array.isArray(prophetKit), "prophet reference kit must exist");

  const prophetSpellEntries = prophetKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    prophetSpellEntries.length,
    CANONICAL_PROPHET_KIT.length,
    "prophet reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_PROPHET_KIT) {
    const entry = prophetSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) =>
        kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `prophet reference kit must include ${expected.spellId}`);
    assert.equal(
      entry.minLevel,
      expected.minLevel,
      `${expected.spellId} must unlock at level ${expected.minLevel}`,
    );
    assert.equal(entry.classId, "prophet");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }
});

test("canonical prophet runtime spells exist in SPELLS", () => {
  for (const expected of CANONICAL_PROPHET_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }
});

test("prophet bespoke spellkit seed stays aligned with canonical runtime truth", () => {
  const seed061 = readRepoFile("infra/schema/061_seed_prophet_spellkit_L1_10.sql");

  for (const { spellId, minLevel } of CANONICAL_PROPHET_KIT) {
    assert.match(
      seed061,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `061 must reference canonical prophet spell ${spellId}`,
    );
    assert.match(
      seed061,
      new RegExp(`\\('prophet'\\s*,\\s*'${escapeRegex(spellId)}'\\s*,\\s*${minLevel}\\s*,`, "m"),
      `061 must unlock ${spellId} for prophet at level ${minLevel}`,
    );
  }
});
