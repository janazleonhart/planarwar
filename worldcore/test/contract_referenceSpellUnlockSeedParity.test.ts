// worldcore/test/contract_referenceSpellUnlockSeedParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveSchemaPath(fileName: string): string {
  const candidates = [
    path.resolve(__dirname, "../infra/schema", fileName),
    path.resolve(__dirname, "../../worldcore/infra/schema", fileName),
    path.resolve(process.cwd(), "infra/schema", fileName),
    path.resolve(process.cwd(), "worldcore/infra/schema", fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Unable to locate ${fileName} from ${__dirname}`);
}

function readSchemaFile(fileName: string): string {
  return fs.readFileSync(resolveSchemaPath(fileName), "utf8");
}

test("reference spell unlock seed notes stay aligned with canonical vulnerability semantics", () => {
  const unlocksSql = readSchemaFile("051_seed_spell_unlocks_reference_kits_l1_10.sql");

  assert.match(
    unlocksSql,
    /warlock_unholy_brand[^]*damageTakenPct debuff/,
    "warlock_unholy_brand unlock note should describe damageTakenPct semantics",
  );

  assert.doesNotMatch(
    unlocksSql,
    /warlock_unholy_brand[^]*damageDealtPct debuff/,
    "warlock_unholy_brand unlock note should not describe stale damageDealtPct semantics",
  );
});
