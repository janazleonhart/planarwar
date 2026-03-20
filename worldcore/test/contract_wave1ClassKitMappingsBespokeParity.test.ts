// worldcore/test/contract_wave1ClassKitMappingsBespokeParity.test.ts

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

test("wave1 class_kit_mappings does not keep templar-map rows for classes with bespoke spellkits", () => {
  const seedSql = readSeed();

  assert.match(seedSql, /DELETE FROM public\.class_kit_mappings WHERE class_id IN \('templar'\);/);
  assert.match(seedSql, /\('templar','templar','wave1 kit: templar map'\)/);

  assert.doesNotMatch(seedSql, /\('hierophant','templar','wave1 kit: templar map'\)/);
  assert.doesNotMatch(seedSql, /\('ascetic','templar','wave1 kit: templar map'\)/);
  assert.doesNotMatch(seedSql, /\('prophet','templar','wave1 kit: templar map'\)/);
});
