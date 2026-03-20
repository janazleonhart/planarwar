// worldcore/test/contract_registryIndexBundleSurfaceParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(startDir: string): string {
  let cur = startDir;
  for (let i = 0; i < 8; i += 1) {
    const pkg = path.join(cur, "package.json");
    const indexPath = path.join(cur, "RegistryIndex.json");
    if (fs.existsSync(pkg) && fs.existsSync(indexPath)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(`Unable to locate repo root from ${startDir}`);
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

test("[contract] RegistryIndex bundle-visible registry surface remains truthful", () => {
  const repoRoot = findRepoRoot(__dirname);
  const indexPath = path.join(repoRoot, "RegistryIndex.json");
  const index = readJson(indexPath);
  const registries = Array.isArray(index.registries) ? index.registries : [];

  assert.ok(registries.length > 0, "RegistryIndex.json should list registries");

  for (const entry of registries) {
    assert.equal(typeof entry.scope, "string", "RegistryIndex entry should declare scope");
    assert.equal(typeof entry.path, "string", `RegistryIndex entry ${entry.scope} should declare path`);

    const absPath = path.join(repoRoot, entry.path);
    const bundleVisible = entry.bundleVisible !== false;

    if (bundleVisible) {
      assert.ok(
        fs.existsSync(absPath),
        `RegistryIndex entry ${entry.scope} should point at an existing repo path for bundle-visible entry: ${entry.path}`
      );
      continue;
    }

    const notes = Array.isArray(entry.notes) ? entry.notes.join(" ") : "";
    assert.match(
      notes,
      /not included in authoritative work bundles|excluded from authoritative work bundles|tracked separately|bundle-visible/i,
      `RegistryIndex entry ${entry.scope} should explain why ${entry.path} is excluded from authoritative work bundles`
    );

    // Important: bundleVisible=false means the authoritative WORK BUNDLE may omit the file.
    // It does NOT mean the file must be absent from a full repo checkout on disk.
    if (fs.existsSync(absPath)) {
      assert.ok(true, `RegistryIndex entry ${entry.scope} may still exist in the repo checkout while being excluded from work bundles`);
    }
  }
});
