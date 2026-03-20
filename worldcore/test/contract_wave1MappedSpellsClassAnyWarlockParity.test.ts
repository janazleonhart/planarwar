// worldcore/test/contract_wave1MappedSpellsClassAnyWarlockParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveSeedPath(): string {
  const candidates = [
    path.resolve(__dirname, "../infra/schema/056_fix_wave1_mapped_spells_class_any.sql"),
    path.resolve(__dirname, "../../worldcore/infra/schema/056_fix_wave1_mapped_spells_class_any.sql"),
    path.resolve(process.cwd(), "infra/schema/056_fix_wave1_mapped_spells_class_any.sql"),
    path.resolve(process.cwd(), "worldcore/infra/schema/056_fix_wave1_mapped_spells_class_any.sql"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Unable to locate 056_fix_wave1_mapped_spells_class_any.sql from ${__dirname}`);
}

function readSeed(): string {
  return fs.readFileSync(resolveSeedPath(), "utf8");
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

test("wave1 mapped-spells class-any fix promotes canonical warlock reference kit spells", () => {
  const seedSql = readSeed();

  for (const spellId of CANONICAL_WARLOCK_SPELLS) {
    assert.match(
      seedSql,
      new RegExp(`'${spellId}'`),
      `${spellId} must be included in 056 class-any wave1 fix`,
    );
  }

  for (const spellId of STALE_WARLOCK_SPELLS) {
    assert.doesNotMatch(
      seedSql,
      new RegExp(`'${spellId}'`),
      `${spellId} must not remain in 056 class-any wave1 fix`,
    );
  }
});
