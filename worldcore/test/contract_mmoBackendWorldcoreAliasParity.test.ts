//worldcore/test/contract_mmoBackendWorldcoreAliasParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const here = __dirname;
  const direct = path.resolve(here, "../..");
  if (fs.existsSync(path.join(direct, "mmo-backend", "MmoBackendRegistry.json"))) {
    return direct;
  }
  const distAware = path.resolve(here, "../../..");
  if (fs.existsSync(path.join(distAware, "mmo-backend", "MmoBackendRegistry.json"))) {
    return distAware;
  }
  throw new Error(`Unable to resolve repo root from ${here}`);
}

function worldcoreRefToExpectedSource(ref: string): string {
  const alias = ref.slice("worldcore:".length);
  const slash = alias.indexOf("/");
  assert.notEqual(slash, -1, `Malformed worldcore alias: ${ref}`);
  const moduleDir = alias.slice(0, slash);
  const symbol = alias.slice(slash + 1);
  const fileStem = symbol.split(".")[0];
  return path.join("worldcore", moduleDir, `${fileStem}.ts`);
}

test("[contract] mmo-backend worldcore aliases resolve to real worldcore sources", () => {
  const repoRoot = resolveRepoRoot();
  const registryPath = path.join(repoRoot, "mmo-backend", "MmoBackendRegistry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const services = registry.services as Record<string, { dependsOn?: string[] }>;

  const refs = new Set<string>();
  for (const service of Object.values(services)) {
    for (const dep of service.dependsOn ?? []) {
      if (dep.startsWith("worldcore:")) refs.add(dep);
    }
  }

  assert.ok(refs.size > 0, "MmoBackendRegistry should declare worldcore dependencies");

  for (const ref of [...refs].sort()) {
    const expectedSource = worldcoreRefToExpectedSource(ref);
    const absoluteSource = path.join(repoRoot, expectedSource);
    assert.ok(
      fs.existsSync(absoluteSource),
      `${ref} should resolve to existing source file ${expectedSource}`,
    );
  }

  const entryDeps = services["mmo-backend.entry"]?.dependsOn ?? [];
  assert.ok(
    entryDeps.includes("worldcore:npc/NpcSpawnController"),
    "mmo-backend.entry should depend on worldcore:npc/NpcSpawnController",
  );
});
