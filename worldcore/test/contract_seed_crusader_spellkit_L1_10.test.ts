// worldcore/test/contract_seed_crusader_spellkit_L1_10.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(distTestDir: string): string {
  return path.resolve(distTestDir, "../../..");
}

function mustInclude(haystack: string, needle: string, label: string) {
  assert.ok(haystack.includes(needle), `${label} should mention ${needle}`);
}

test("[contract] crusader L1–10 spellkit seed exists + includes spell+unlock ids", () => {
  const repoRoot = repoRootFromDistTestDir(__dirname);
  const file = path.join(repoRoot, "worldcore/infra/schema/056_seed_crusader_spellkit_L1_10.sql");
  assert.ok(fs.existsSync(file), `seed file missing: ${path.relative(repoRoot, file)}`);

  const src = fs.readFileSync(file, "utf8");

  // Spell ids
  for (const id of [
    "crusader_righteous_strike",
    "crusader_bleeding_wound",
    "crusader_minor_mend",
    "crusader_sun_guard",
    "crusader_judgment",
  ]) {
    mustInclude(src, id, "056_seed_crusader_spellkit_L1_10.sql");
  }

  // Ensure it also touches unlocks table.
  mustInclude(src, "spell_unlocks", "056_seed_crusader_spellkit_L1_10.sql");
  mustInclude(src, "DELETE FROM public.spell_unlocks", "056_seed_crusader_spellkit_L1_10.sql");
});
