// worldcore/test/contract_schemaOrderPolicy.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { compareSchemaFilenames, parseSchemaNumericPrefix } from "../tools/schemaOrderPolicy";

test("[contract] schema order policy: parses numeric prefixes", () => {
  assert.deepEqual(parseSchemaNumericPrefix("007_items.sql"), { raw: "007", num: 7 });
  assert.deepEqual(parseSchemaNumericPrefix("7_items.sql"), { raw: "7", num: 7 });
  assert.equal(parseSchemaNumericPrefix("no_prefix.sql"), null);
  assert.equal(parseSchemaNumericPrefix("_bad.sql"), null);
});

test("[contract] schema order policy: sorts by numeric prefix, tie-break lexicographic", () => {
  const files = [
    "010_alpha.sql",
    "2_beta.sql",
    "002_gamma.sql",
    "7_zeta.sql",
    "007_eta.sql",
    "010_aaa.sql",
    "no_prefix.sql",
  ];

  const sorted = files.slice().sort(compareSchemaFilenames);

  // Numeric first (ascending), then non-numeric.
  assert.deepEqual(sorted, [
    // num=2 tie-break lexicographic
    "002_gamma.sql",
    "2_beta.sql",
    // num=7 tie-break lexicographic
    "007_eta.sql",
    "7_zeta.sql",
    // num=10 tie-break lexicographic
    "010_aaa.sql",
    "010_alpha.sql",
    // non-numeric
    "no_prefix.sql",
  ]);
});
