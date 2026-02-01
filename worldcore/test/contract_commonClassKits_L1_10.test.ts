// worldcore/test/contract_commonClassKits_L1_10.test.ts
// Contract guard: the repo contains an idempotent seed file that grants a minimal L1–10 kit
// to classes that don't yet have bespoke kits (so every class remains playable).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function mustContain(haystack: string, needle: string, msg: string): void {
  assert.ok(haystack.includes(needle), msg);
}

function mustMatch(haystack: string, re: RegExp, msg: string): void {
  assert.ok(re.test(haystack), msg);
}

test("[contract] common class kits seed exists + grants L1–10 kit to missing classes", () => {
  const repoRoot = repoRootFromDistTestDir();
  const seedPath = path.join(
    repoRoot,
    "worldcore",
    "infra",
    "schema",
    "054_seed_common_class_kits_L1_10.sql",
  );

  const src = readTextOrFail(seedPath);

  // Must seed common spells
  const spellIds = ["common_strike", "common_bleeding_wound", "common_sundered_guard", "common_barrier", "common_second_wind"] as const;
  for (const id of spellIds) {
    mustContain(src, `'${id}'`, `seed should mention common spell id ${id}`);
  }

  // Must insert into spells + spell_unlocks
  mustMatch(src, /INSERT\s+INTO\s+public\.spells\s*\(/i, "seed should INSERT into public.spells");
  mustMatch(src, /INSERT\s+INTO\s+public\.spell_unlocks\s*\(/i, "seed should INSERT into public.spell_unlocks");

  // Must cover all target classes at least once
  const classes = ["illusionist", "ascetic", "prophet", "crusader", "revenant", "hierophant", "defiler", "conjuror", "cutthroat", "ravager", "primalist", "outrider", "hunter", "runic_knight"] as const;
  for (const cls of classes) {
    mustContain(src, `'${cls}'`, `seed should include unlocks for class ${cls}`);
  }

  // Quick sanity: ensure the expected level gates exist for at least one class.
  // (We don't lock formatting, just the semantic payload.)
  mustMatch(
    src,
    /\('\s*illusionist\s*'\s*,\s*'common_strike'\s*,\s*1\s*,\s*true/i,
    "illusionist should autogrant common_strike at level 1",
  );
  mustMatch(
    src,
    /\('\s*illusionist\s*'\s*,\s*'common_bleeding_wound'\s*,\s*3\s*,\s*true/i,
    "illusionist should autogrant common_bleeding_wound at level 3",
  );
  mustMatch(
    src,
    /\('\s*illusionist\s*'\s*,\s*'common_sundered_guard'\s*,\s*5\s*,\s*true/i,
    "illusionist should autogrant common_sundered_guard at level 5",
  );
  mustMatch(
    src,
    /\('\s*illusionist\s*'\s*,\s*'common_barrier'\s*,\s*7\s*,\s*true/i,
    "illusionist should autogrant common_barrier at level 7",
  );
  mustMatch(
    src,
    /\('\s*illusionist\s*'\s*,\s*'common_second_wind'\s*,\s*9\s*,\s*true/i,
    "illusionist should autogrant common_second_wind at level 9",
  );
});
