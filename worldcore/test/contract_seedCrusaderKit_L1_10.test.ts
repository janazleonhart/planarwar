// worldcore/test/contract_seedCrusaderKit_L1_10.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  const parts = path.resolve(__dirname).split(path.sep);
  const distIdx = parts.lastIndexOf("dist");
  if (distIdx >= 0) return parts.slice(0, distIdx).join(path.sep);
  const wcIdx = parts.lastIndexOf("worldcore");
  if (wcIdx >= 0) return parts.slice(0, wcIdx).join(path.sep);
  throw new Error(`Cannot infer repo root from __dirname=${__dirname}`);
}

const EXPECTED = [
  "crusader_righteous_strike",
  "crusader_bleeding_wound",
  "crusader_minor_mend",
  "crusader_sun_guard",
  "crusader_judgment",
];

test("[contract] seed crusader spellkit L1–10 exists + includes expected ids", () => {
  const repoRoot = repoRootFromDistTestDir();
  const p = path.join(repoRoot, "worldcore", "infra", "schema", "056_seed_crusader_spellkit_L1_10.sql");
  assert.ok(fs.existsSync(p), `missing seed: ${p}`);

  const sql = fs.readFileSync(p, "utf8");
  assert.ok(/insert\s+into\s+public\.spells/i.test(sql), "seed should insert into public.spells");
  assert.ok(/insert\s+into\s+public\.spell_unlocks/i.test(sql), "seed should insert into public.spell_unlocks");

  for (const id of EXPECTED) {
    assert.ok(sql.includes(id), `seed should mention ${id}`);
  }
});
