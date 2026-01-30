// worldcore/test/contract_seedSpellUnlocksReferToSeededSpells.test.ts
//
// “Contract seatbelt”: schema/seed integrity.
// Any spell_id referenced by seed spell_unlocks must exist in seeded spells.
// This prevents FK failures during schema apply / seed runs.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { runSeedSpellIdAudit } from "../tools/seedSpellIdAudit";

test("[contract] seed spell_unlocks spell_id must exist in seeded spells", () => {
  // npm test -w worldcore runs with cwd=<repo>/worldcore
  const schemaDir = path.resolve(process.cwd(), "infra", "schema");

  const res = runSeedSpellIdAudit({ schemaDir });

  assert.equal(
    res.missingSpellIds.length,
    0,
    `seed integrity: ${res.missingSpellIds.length} spell_unlocks spell_id(s) missing from spells seed:\n` +
      res.missingSpellIds.map((s) => `- ${s}`).join("\n")
  );
});
