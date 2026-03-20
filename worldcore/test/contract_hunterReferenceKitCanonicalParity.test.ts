// worldcore/test/contract_hunterReferenceKitCanonicalParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_CLASS_KITS_L1_10, type ReferenceKitEntry } from "../spells/ReferenceKits";
import { SPELLS } from "../spells/SpellTypes";

const CANONICAL_HUNTER_KIT = [
  { spellId: "hunter_steady_shot", minLevel: 1 },
  { spellId: "hunter_serrated_arrow", minLevel: 3 },
  { spellId: "hunter_hunters_mark", minLevel: 5 },
  { spellId: "hunter_field_dressing", minLevel: 7 },
  { spellId: "hunter_aimed_shot", minLevel: 9 },
] as const;

const PRE_CLEANUP_HUNTER_KIT = [
  "hunter_quick_shot",
  "hunter_serpent_sting",
  "hunter_hunters_mark",
  "hunter_evasive_roll",
  "hunter_aimed_shot",
] as const;

const CLEANUP_REMOVED_HUNTER_IDS = [
  "hunter_quick_shot",
  "hunter_serpent_sting",
  "hunter_evasive_roll",
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

test("hunter runtime reference kit uses canonical current L1-10 spell ids and levels", () => {
  const hunterKit = REFERENCE_CLASS_KITS_L1_10.hunter;
  assert.ok(Array.isArray(hunterKit), "hunter reference kit must exist");

  const hunterSpellEntries = hunterKit.filter(
    (entry: ReferenceKitEntry): entry is Extract<ReferenceKitEntry, { kind: "spell" }> =>
      entry.kind === "spell",
  );

  assert.equal(
    hunterSpellEntries.length,
    CANONICAL_HUNTER_KIT.length,
    "hunter reference kit should contain exactly the canonical five spell entries",
  );

  for (const expected of CANONICAL_HUNTER_KIT) {
    const entry = hunterSpellEntries.find(
      (kitEntry: Extract<ReferenceKitEntry, { kind: "spell" }>) =>
        kitEntry.spellId === expected.spellId,
    );

    assert.ok(entry, `hunter reference kit must include ${expected.spellId}`);
    assert.equal(
      entry.minLevel,
      expected.minLevel,
      `${expected.spellId} must unlock at level ${expected.minLevel}`,
    );
    assert.equal(entry.classId, "hunter");
    assert.equal(entry.autoGrant, true);
    assert.equal(entry.isEnabled, true);
    assert.equal(entry.source, "reference_kit");
  }
});

test("canonical hunter runtime spells exist in SPELLS", () => {
  for (const expected of CANONICAL_HUNTER_KIT) {
    const spell = SPELLS[expected.spellId];
    assert.ok(spell, `${expected.spellId} must exist in SPELLS`);
  }
});

test("hunter canonical spell ids stay aligned with final cleanup migration truth", () => {
  const seed057 = readRepoFile("infra/schema/057_seed_hunter_spellkit_L1_10.sql");
  const seed058 = readRepoFile("infra/schema/058_cleanup_hunter_spellkit_L1_10.sql");

  for (const spellId of PRE_CLEANUP_HUNTER_KIT) {
    assert.match(
      seed057,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `057 should show pre-cleanup Hunter v1 spell ${spellId}`,
    );
  }

  for (const spellId of CLEANUP_REMOVED_HUNTER_IDS) {
    assert.match(
      seed058,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `058 should explicitly remove pre-cleanup hunter spell ${spellId}`,
    );
  }

  for (const { spellId } of CANONICAL_HUNTER_KIT) {
    assert.match(
      seed058,
      new RegExp(`'${escapeRegex(spellId)}'`, "m"),
      `058 should install canonical hunter spell ${spellId}`,
    );
  }
});

test("hunter cleanup migration replaces old hunter ability mapping", () => {
  const seed058 = readRepoFile("infra/schema/058_cleanup_hunter_spellkit_L1_10.sql");

  assert.match(
    seed058,
    /DELETE\s+FROM\s+public\.ability_unlocks[\s\S]*?class_id\s*=\s*'hunter'/m,
    "058 should delete old hunter ability mappings",
  );

  assert.match(
    seed058,
    /DELETE\s+FROM\s+public\.spell_unlocks[\s\S]*?class_id\s*=\s*'hunter'/m,
    "058 should replace hunter spell unlocks",
  );
});