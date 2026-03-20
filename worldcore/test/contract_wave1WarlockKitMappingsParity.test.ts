// worldcore/test/contract_wave1WarlockKitMappingsParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveSeedPath(): string {
  const candidates = [
    path.resolve(__dirname, "../infra/schema/055_seed_wave1_class_kit_mappings_L1_10.sql"),
    path.resolve(__dirname, "../../worldcore/infra/schema/055_seed_wave1_class_kit_mappings_L1_10.sql"),
    path.resolve(process.cwd(), "infra/schema/055_seed_wave1_class_kit_mappings_L1_10.sql"),
    path.resolve(process.cwd(), "worldcore/infra/schema/055_seed_wave1_class_kit_mappings_L1_10.sql"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Unable to locate 055_seed_wave1_class_kit_mappings_L1_10.sql from ${__dirname}`);
}

function readSeed(): string {
  return fs.readFileSync(resolveSeedPath(), "utf8");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CANONICAL_WARLOCK_SPELLS = [
  "warlock_shadow_bolt",
  "warlock_siphon_life",
  "warlock_drain_soul",
  "warlock_unholy_brand",
  "warlock_demon_skin",
] as const;

const STALE_WARLOCK_SPELLS = [
  "warlock_weakening_curse",
  "warlock_corruption",
  "warlock_demonic_barrier",
  "warlock_soul_siphon",
] as const;

function assertClassUsesCanonicalWarlockKit(seedSql: string, classId: string): void {
  for (const spellId of CANONICAL_WARLOCK_SPELLS) {
    assert.match(
      seedSql,
      new RegExp(`\\('${escapeRegex(classId)}'\\s*,\\s*'${escapeRegex(spellId)}'\\s*,`, "m"),
      `${classId} must map to canonical warlock spell ${spellId}`,
    );
  }

  for (const spellId of STALE_WARLOCK_SPELLS) {
    assert.doesNotMatch(
      seedSql,
      new RegExp(`\\('${escapeRegex(classId)}'\\s*,\\s*'${escapeRegex(spellId)}'\\s*,`, "m"),
      `${classId} must not map to stale warlock spell ${spellId}`,
    );
  }
}

test("wave1 revenant warlock kit mapping uses canonical current warlock reference kit spells", () => {
  const seedSql = readSeed();
  assertClassUsesCanonicalWarlockKit(seedSql, "revenant");
});

test("wave1 defiler warlock kit mapping uses canonical current warlock reference kit spells", () => {
  const seedSql = readSeed();
  assertClassUsesCanonicalWarlockKit(seedSql, "defiler");
});