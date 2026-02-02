// worldcore/test/contract_crusaderKit_L1_10.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(distTestDir: string): string {
  // dist/worldcore/test -> repo root
  return path.resolve(distTestDir, "../../..")
}

function mustInclude(haystack: string, needle: string, msg: string) {
  assert.ok(haystack.includes(needle), msg);
}

test("[contract] crusader L1–10 reference kit exists (5 spells)", () => {
  const repoRoot = repoRootFromDistTestDir(__dirname);
  const kitsPath = path.join(repoRoot, "worldcore/spells/ReferenceKits.ts");
  assert.ok(fs.existsSync(kitsPath), `missing file: ${path.relative(repoRoot, kitsPath)}`);

  const txt = fs.readFileSync(kitsPath, "utf8");

  // Sanity: class key exists
  mustInclude(txt, "crusader:", "ReferenceKits.ts should define crusader kit");

  // Spell IDs that must exist (unique crusader kit)
  const must = [
    "crusader_righteous_strike",
    "crusader_bleeding_wound",
    "crusader_minor_mend",
    "crusader_sun_guard",
    "crusader_judgment",
  ];

  for (const id of must) {
    mustInclude(txt, id, `ReferenceKits.ts should mention ${id}`);
  }
});
