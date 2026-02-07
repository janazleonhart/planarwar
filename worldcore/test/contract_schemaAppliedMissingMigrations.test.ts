// worldcore/test/contract_schemaAppliedMissingMigrations.test.ts
// Contract: applied-migration missing-on-disk detection is deterministic and allow-listable.

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAppliedMissingOnDisk,
  parseSchemaIgnoreJson,
  parseSchemaIgnoreTxt,
} from "../tools/schemaMissingMigrationsLib";

test("[contract] schema missing guard: reports applied ids missing on disk", () => {
  const applied = ["001_a.sql", "002_b.sql", "003_c.sql"];
  const disk = ["001_a.sql", "003_c.sql"];

  const missing = computeAppliedMissingOnDisk({ appliedIds: applied, diskIds: disk });
  assert.deepEqual(missing, ["002_b.sql"]);
});

test("[contract] schema missing guard: ignore list suppresses reported missing ids", () => {
  const applied = ["001_a.sql", "002_b.sql", "003_c.sql"];
  const disk = ["001_a.sql", "003_c.sql"];
  const ignore = new Set(["002_b.sql"]);

  const missing = computeAppliedMissingOnDisk({ appliedIds: applied, diskIds: disk, ignoreIds: ignore });
  assert.deepEqual(missing, []);
});

test("[contract] schema missing guard: parses ignore JSON array and object shapes", () => {
  assert.deepEqual(parseSchemaIgnoreJson('["001_a.sql","002_b.sql"]'), ["001_a.sql", "002_b.sql"]);
  assert.deepEqual(parseSchemaIgnoreJson('{"ignore":["001_a.sql"],"missing":["002_b.sql"]}'), ["001_a.sql", "002_b.sql"]);
});

test("[contract] schema missing guard: parses ignore txt with comments", () => {
  const txt = "# comment\n001_a.sql\n\n  002_b.sql  \n# another\n";
  assert.deepEqual(parseSchemaIgnoreTxt(txt), ["001_a.sql", "002_b.sql"]);
});
