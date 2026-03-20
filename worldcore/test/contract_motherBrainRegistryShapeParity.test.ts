//worldcore/test/contract_motherBrainRegistryShapeParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const here = __dirname;
  const direct = path.resolve(here, "../..");
  if (fs.existsSync(path.join(direct, "mother-brain", "MotherBrainRegistry.json"))) {
    return direct;
  }
  const distAware = path.resolve(here, "../../..");
  if (fs.existsSync(path.join(distAware, "mother-brain", "MotherBrainRegistry.json"))) {
    return distAware;
  }
  throw new Error(`Unable to resolve repo root from ${here}`);
}

test("[contract] Mother Brain registry exposes non-empty services parity for cross-registry tooling", () => {
  const repoRoot = resolveRepoRoot();
  const registryPath = path.join(repoRoot, "mother-brain", "MotherBrainRegistry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
    services?: Record<string, { path?: string }>;
    entries?: Record<string, { path?: string }>;
    notes?: string[];
  };

  const services = registry.services ?? {};
  const entries = registry.entries ?? {};

  assert.ok(Object.keys(services).length > 0, "MotherBrainRegistry should expose non-empty services for cross-registry tooling");
  assert.ok(Object.keys(entries).length > 0, "MotherBrainRegistry should retain legacy entries until compatibility consumers are migrated");

  for (const [id, entry] of Object.entries(entries)) {
    const service = services[id];
    assert.ok(service, `MotherBrainRegistry.services should mirror legacy entry id ${id}`);
    assert.equal(service.path, entry.path, `MotherBrainRegistry.services.${id} should preserve path parity with legacy entries`);
    const absolutePath = path.join(repoRoot, entry.path ?? "");
    assert.ok(fs.existsSync(absolutePath), `${id} should point at existing file ${entry.path}`);
  }

  assert.ok(
    (registry.notes ?? []).some((note) => String(note).includes("services mirrors entries")),
    "MotherBrainRegistry notes should explain services/entries compatibility parity",
  );
});
