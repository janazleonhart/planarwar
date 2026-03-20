//worldcore/test/contract_crusaderClassKitSeedTyping.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveSeedPath(): string {
  const candidates = [
    path.resolve(__dirname, "../infra/schema/056_seed_crusader_class_kit_L1_10.sql"),
    path.resolve(__dirname, "../../worldcore/infra/schema/056_seed_crusader_class_kit_L1_10.sql"),
    path.resolve(process.cwd(), "infra/schema/056_seed_crusader_class_kit_L1_10.sql"),
    path.resolve(process.cwd(), "worldcore/infra/schema/056_seed_crusader_class_kit_L1_10.sql"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Unable to locate 056_seed_crusader_class_kit_L1_10.sql from ${__dirname}`);
}

function readSeed(): string {
  return fs.readFileSync(resolveSeedPath(), "utf8");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSpellUsesTextArrayTags(seedSql: string, spellId: string): void {
  const rowPattern = new RegExp(
    `\\(\\s*'${escapeRegex(spellId)}'[\\s\\S]*?ARRAY\\[[^\\]]+\\]::text\\[]?[\\s\\S]*?\\)\\s*(?:,|ON CONFLICT)`,
    "m",
  );
  const rowMatch = seedSql.match(rowPattern);
  assert.ok(rowMatch, `${spellId} row must use ARRAY[...]::text[] for tags`);

  assert.doesNotMatch(
    rowMatch[0],
    /'\[[^\n]*\]'::jsonb|to_jsonb\(ARRAY\[/,
    `${spellId} row must not encode public.spells tags as jsonb`,
  );
}

test("crusader class kit seed uses text[] tags for public.spells rows", () => {
  const seedSql = readSeed();

  for (const spellId of [
    "crusader_oathbound_strike",
    "crusader_sanctuary",
    "crusader_purging_vow",
    "crusader_fervor",
    "crusader_verdict",
  ]) {
    assertSpellUsesTextArrayTags(seedSql, spellId);
  }
});
