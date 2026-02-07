// worldcore/test/contract_schemaMigrationDriftGuard.test.ts
// Contract: schema migration tooling has stable checksum + deterministic file ordering.
//
// This is a "data migration hygiene" guard: drift checks rely on sha256 being stable
// and the schema dir scanning being deterministic.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  computeSha256Hex,
  listSchemaMigrationFiles,
  isSchemaMigrationFilename,
} from "../tools/schemaMigrationLib";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

test("[contract] schema migration lib: sha256 is stable + changes with input", () => {
  const a = computeSha256Hex("hello");
  const b = computeSha256Hex("hello");
  const c = computeSha256Hex("hello!");

  assert.equal(a, b, "same input should yield same checksum");
  assert.notEqual(a, c, "different input should yield different checksum");
  assert.equal(a.length, 64, "sha256 hex should be 64 chars");
});

test("[contract] schema migration lib: filename filter matches 3-digit convention", () => {
  assert.ok(isSchemaMigrationFilename("001_init.sql"));
  assert.ok(isSchemaMigrationFilename("123_hello_world.sql"));
  assert.ok(!isSchemaMigrationFilename("01_bad.sql"));
  assert.ok(!isSchemaMigrationFilename("abc_nope.sql"));
  assert.ok(!isSchemaMigrationFilename("999_missing_ext.txt"));
});

test("[contract] schema migration lib: schema file list is deterministic and sorted", () => {
  const repoRoot = repoRootFromDistTestDir();
  const schemaDir = path.join(repoRoot, "worldcore", "infra", "schema");

  const files = listSchemaMigrationFiles(schemaDir);
  assert.ok(files.length > 0, "expected at least 1 schema migration file");

  // Ensure strictly non-decreasing lexicographic ordering.
  for (let i = 1; i < files.length; i++) {
    const prev = files[i - 1] ?? "";
    const cur = files[i] ?? "";
    assert.ok(prev.localeCompare(cur) <= 0, `expected sorted order: ${prev} <= ${cur}`);
  }

  // Spot-check shape
  for (const f of files.slice(0, Math.min(5, files.length))) {
    assert.ok(/^\d{3}_.+\.sql$/i.test(f), `expected migration name format for: ${f}`);
  }
});
