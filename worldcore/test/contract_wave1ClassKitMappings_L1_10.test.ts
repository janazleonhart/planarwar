// worldcore/test/contract_wave1ClassKitMappings_L1_10.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(distTestDir: string): string {
  return path.resolve(distTestDir, "../../..")
}

function mustInclude(haystack: string, needle: string, msg: string) {
  assert.ok(haystack.includes(needle), msg);
}

test("[contract] wave1 class kit mappings seed exists + covers expected classes", () => {
  const repoRoot = repoRootFromDistTestDir(__dirname);
  const seedPath = path.join(repoRoot, "worldcore/infra/schema/055_seed_wave1_class_kit_mappings_L1_10.sql");
  assert.ok(fs.existsSync(seedPath), `seed file missing: ${path.relative(repoRoot, seedPath)}`);

  const txt = fs.readFileSync(seedPath, "utf8");

  // We still expect the wave1 templar-mapping mechanism to exist for classes
  // that do NOT yet have unique L1–10 kits.
  // IMPORTANT: crusader is intentionally *not* included once it has a unique kit.
  const must = [
    "INSERT INTO public.class_kit_mappings",
    "('templar'", // templar target should exist
  ];

  for (const s of must) {
    mustInclude(txt, s, `seed should include: ${s}`);
  }

  // Safety: crusader should NOT be templar-mapped anymore.
  assert.ok(!txt.includes("'crusader'"), "crusader should not appear in wave1 kit mappings (unique kit now)");
});
