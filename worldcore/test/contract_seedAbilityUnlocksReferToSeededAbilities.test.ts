// worldcore/test/contract_seedAbilityUnlocksReferToSeededAbilities.test.ts

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { runSeedAbilityIdAudit } from "../tools/seedAbilityIdAudit";

test("[contract] seed ability_unlocks ability_id must be covered by abilities seeding flow", () => {
  // npm test -w worldcore runs with cwd=<repo>/worldcore
  const schemaDir = path.resolve(process.cwd(), "infra", "schema");

  const res = runSeedAbilityIdAudit({ schemaDir });

  assert.equal(
    res.missingAbilityIds.length,
    0,
    `seed integrity: ${res.missingAbilityIds.length} ability_unlocks ability_id(s) not covered by abilities seeding flow:\n` +
      res.missingAbilityIds.map((s) => `- ${s}`).join("\n")
  );
});
