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

type UnlockNoteExpectation = {
  spellId: string;
  expectedNote: string;
  staleNote?: string;
};

const EXPECTATIONS: readonly UnlockNoteExpectation[] = [
  {
    spellId: "archmage_expose_arcana",
    expectedNote: "damageTakenPct debuff",
  },
  {
    spellId: "warlock_unholy_brand",
    expectedNote: "damageTakenPct debuff",
    staleNote: "damageDealtPct debuff",
  },
  {
    spellId: "templar_judgment",
    expectedNote: "damageTakenPct debuff",
  },
] as const;

test("reference spell unlock seed notes stay aligned with canonical vulnerability semantics", () => {
  const unlocksSql = readSchemaFile("051_seed_spell_unlocks_reference_kits_l1_10.sql");

  for (const expectation of EXPECTATIONS) {
    assert.match(
      unlocksSql,
      new RegExp(`${expectation.spellId}[^]*${expectation.expectedNote}`),
      `${expectation.spellId} unlock note should describe ${expectation.expectedNote} semantics`,
    );

    if (expectation.staleNote) {
      assert.doesNotMatch(
        unlocksSql,
        new RegExp(`${expectation.spellId}[^]*${expectation.staleNote}`),
        `${expectation.spellId} unlock note should not describe stale ${expectation.staleNote} semantics`,
      );
    }
  }
});
