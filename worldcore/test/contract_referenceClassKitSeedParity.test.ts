// worldcore/test/contract_referenceClassKitSeedParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveSeedPath(): string {
  const candidates = [
    path.resolve(__dirname, "../infra/schema/050_seed_reference_class_kits_L1_10.sql"),
    path.resolve(__dirname, "../../worldcore/infra/schema/050_seed_reference_class_kits_L1_10.sql"),
    path.resolve(process.cwd(), "infra/schema/050_seed_reference_class_kits_L1_10.sql"),
    path.resolve(process.cwd(), "worldcore/infra/schema/050_seed_reference_class_kits_L1_10.sql"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Unable to locate 050_seed_reference_class_kits_L1_10.sql from ${__dirname}`);
}

function readSeed(): string {
  return fs.readFileSync(resolveSeedPath(), "utf8");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSpellModifier(
  seedSql: string,
  spellId: string,
  expectedModifierSnippet: string,
): void {
  const blockPattern = new RegExp(
    `\\(\\s*'${escapeRegex(spellId)}'[\\s\\S]*?\\)\\s*(?:,|ON CONFLICT)`,
    "m",
  );
  const blockMatch = seedSql.match(blockPattern);
  assert.ok(blockMatch, `${spellId} block must exist in 050 seed`);
  assert.match(
    blockMatch[0],
    new RegExp(escapeRegex(expectedModifierSnippet)),
    `${spellId} must contain ${expectedModifierSnippet} in status_effect modifiers`,
  );
}

function assertUnlockNote(
  seedSql: string,
  classId: string,
  spellId: string,
  expectedSnippet: string,
): void {
  const rowPattern = new RegExp(
    `\\('${escapeRegex(classId)}'\\s*,\\s*'${escapeRegex(spellId)}'[\\s\\S]*?\\)`,
    "m",
  );
  const rowMatch = seedSql.match(rowPattern);
  assert.ok(rowMatch, `${classId}/${spellId} unlock row must exist in 050 seed`);
  assert.match(
    rowMatch[0],
    new RegExp(escapeRegex(expectedSnippet)),
    `${classId}/${spellId} unlock note must contain ${expectedSnippet}`,
  );
}

test("reference class kit seed keeps canonical vulnerability modifier semantics", () => {
  const seedSql = readSeed();

  assertSpellModifier(seedSql, "archmage_expose_arcana", '"modifiers":{"damageTakenPct":0.15}');
  assertSpellModifier(seedSql, "warlock_unholy_brand", '"modifiers":{"damageTakenPct":0.08}');
  assertSpellModifier(seedSql, "templar_judgment", '"modifiers":{"damageTakenPct":0.07}');

  assert.doesNotMatch(
    seedSql,
    /'warlock_unholy_brand'[\s\S]*?"damageDealtPct":0\.08/,
    "warlock_unholy_brand must not keep the legacy outgoing-damage modifier in 050 seed",
  );
});

test("reference class kit seed keeps canonical vulnerability unlock-note semantics", () => {
  const seedSql = readSeed();

  assertUnlockNote(
    seedSql,
    "archmage",
    "archmage_expose_arcana",
    "damageTakenPct debuff",
  );
  assertUnlockNote(
    seedSql,
    "warlock",
    "warlock_unholy_brand",
    "damageTakenPct debuff",
  );
  assertUnlockNote(
    seedSql,
    "templar",
    "templar_judgment",
    "damageTakenPct debuff",
  );

  assert.doesNotMatch(
    seedSql,
    /\('warlock'\s*,\s*'warlock_unholy_brand'[\s\S]*?damageDealtPct debuff/,
    "warlock_unholy_brand unlock note must not use stale damageDealtPct wording",
  );
});