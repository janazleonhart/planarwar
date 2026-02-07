// worldcore/test/contract_schemaFilenameAudit.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { extractNumericPrefix, findDuplicateSchemaPrefixes } from "../tools/schemaFilenameAudit";

test("[contract] schema filename audit: extracts numeric prefix", () => {
  assert.equal(extractNumericPrefix("001_init.sql"), "001");
  assert.equal(extractNumericPrefix("42_init.sql"), "42");
  assert.equal(extractNumericPrefix("no_prefix.sql"), null);
  assert.equal(extractNumericPrefix("007-items.sql"), "007");
});

test("[contract] schema filename audit: detects duplicate numeric prefixes deterministically", () => {
  const files = [
    "001_init.sql",
    "007_items.sql",
    "007_character_state.sql",
    "042_create_spells_table.sql",
    "042_seed_spells.sql",
    "042_create_abilities_table.sql",
    "100_done.sql",
  ];

  const collisions = findDuplicateSchemaPrefixes(files);

  // Sorted by numeric prefix ascending.
  assert.deepEqual(collisions, [
    { prefix: "007", files: ["007_character_state.sql", "007_items.sql"] },
    {
      prefix: "042",
      files: [
        "042_create_abilities_table.sql",
        "042_create_spells_table.sql",
        "042_seed_spells.sql",
      ],
    },
  ]);
});
