// worldcore/test/contract_wave1ClassKitMappings_L1_10.test.ts
//
// Contract: Wave 1 class kit mappings seed exists and covers expected classes.
// This is intentionally NOT DB-coupled. It verifies the seed file content so we don't
// accidentally remove the coverage kits while adding bespoke kits later.
//
// NOTE: tests are executed with cwd sometimes set to the workspace folder (e.g. .../planarwar/worldcore).
// We therefore locate the repo root dynamically by walking upward until we can find the seed file.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function mustInclude(haystack: string, needle: string, msg: string) {
  assert.ok(haystack.includes(needle), msg);
}

function countMatches(haystack: string, re: RegExp): number {
  const m = haystack.match(re);
  return m ? m.length : 0;
}

function findSeedPath(): string {
  const rel = path.join("worldcore", "infra", "schema", "055_seed_wave1_class_kit_mappings_L1_10.sql");
  let dir = process.cwd();

  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, rel);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: if cwd is already ".../worldcore", common case is "../worldcore/infra/schema/..."
  const fallback = path.resolve(process.cwd(), "..", rel);
  if (fs.existsSync(fallback)) return fallback;

  return path.resolve(process.cwd(), rel);
}

test("[contract] wave1 class kit mappings seed exists + covers expected classes", () => {
  const seedPath = findSeedPath();
  assert.ok(fs.existsSync(seedPath), `seed file missing: ${seedPath}`);

  const sql = fs.readFileSync(seedPath, "utf-8");

  // Presence checks (guards renames)
  mustInclude(sql, "INSERT INTO public.spell_unlocks", "seed should insert spell_unlocks");
  mustInclude(sql, "INSERT INTO public.ability_unlocks", "seed should insert ability_unlocks");
  mustInclude(sql, "wave1 kit:", "seed should tag notes with wave1 kit markers");

  // Expected class coverage (spells)
  const templarMapped = ["crusader", "hierophant", "ascetic", "prophet"];
  const archmageMapped = ["illusionist", "conjuror", "primalist"];
  const warlockMapped = ["revenant", "defiler"];
  const martialMapped = ["cutthroat", "ravager", "outrider", "hunter", "runic_knight"];

  for (const cid of templarMapped) mustInclude(sql, `('${cid}', 'templar_`, `templar-mapped class missing: ${cid}`);
  for (const cid of archmageMapped) mustInclude(sql, `('${cid}', 'archmage_`, `archmage-mapped class missing: ${cid}`);
  for (const cid of warlockMapped) mustInclude(sql, `('${cid}', 'warlock_`, `warlock-mapped class missing: ${cid}`);
  for (const cid of martialMapped) mustInclude(sql, `('${cid}', 'power_strike'`, `martial-mapped class missing: ${cid}`);

  // Rough row-count sanity (protects against accidental truncation)
  // Spells: templar(4*5) + archmage(3*5) + warlock(2*5) = 45
  // Abilities: martial(5*3) = 15
  assert.ok(countMatches(sql, /\('.*?', 'templar_/g) >= 20, "templar mapping rows look too low");
  assert.ok(countMatches(sql, /\('.*?', 'archmage_/g) >= 10, "archmage mapping rows look too low");
  assert.ok(countMatches(sql, /\('.*?', 'warlock_/g) >= 8, "warlock mapping rows look too low");
  assert.ok(countMatches(sql, /\('.*?', 'power_strike'/g) >= 5, "warrior mapping rows look too low");
});
