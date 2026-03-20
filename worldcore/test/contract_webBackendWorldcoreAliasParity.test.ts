//worldcore/test/contract_webBackendWorldcoreAliasParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const here = __dirname;
  const direct = path.resolve(here, "../..");
  if (fs.existsSync(path.join(direct, "web-backend", "WebBackendRegistry.json"))) {
    return direct;
  }
  const distAware = path.resolve(here, "../../..");
  if (fs.existsSync(path.join(distAware, "web-backend", "WebBackendRegistry.json"))) {
    return distAware;
  }
  throw new Error(`Unable to resolve repo root from ${here}`);
}

function worldcoreRefToExpectedSource(ref: string): string {
  assert.ok(ref.startsWith("worldcore."), `Expected dotted worldcore ref, got ${ref}`);
  return `${ref.replace(/\./g, "/")}.ts`;
}

test("[contract] web-backend dotted worldcore refs resolve to real worldcore sources", () => {
  const repoRoot = resolveRepoRoot();
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const services = registry.services as Record<string, { dependsOn?: string[] }>;

  const refs = new Set<string>();
  for (const service of Object.values(services)) {
    for (const dep of service.dependsOn ?? []) {
      if (dep.startsWith("worldcore.")) refs.add(dep);
    }
  }

  assert.ok(refs.size > 0, "WebBackendRegistry should declare dotted worldcore dependencies");

  for (const ref of [...refs].sort()) {
    const expectedSource = worldcoreRefToExpectedSource(ref);
    const absoluteSource = path.join(repoRoot, expectedSource);
    assert.ok(fs.existsSync(absoluteSource), `${ref} should resolve to existing source file ${expectedSource}`);
  }

  const heartbeatDeps = services["web-backend.server.heartbeat"]?.dependsOn ?? [];
  assert.ok(
    heartbeatDeps.includes("worldcore.db.Database"),
    "web-backend.server.heartbeat should depend on worldcore.db.Database",
  );

  const playerCityAccessDeps = services["web-backend.routes.playerCityAccess"]?.dependsOn ?? [];
  assert.ok(
    playerCityAccessDeps.includes("worldcore.auth.PostgresAuthService"),
    "web-backend.routes.playerCityAccess should depend on worldcore.auth.PostgresAuthService",
  );
  assert.ok(
    playerCityAccessDeps.includes("worldcore.db.Database"),
    "web-backend.routes.playerCityAccess should depend on worldcore.db.Database",
  );

  const protoCatalogDeps = services["web-backend.routes.adminSpawnPoints.protoCatalogOps"]?.dependsOn ?? [];
  assert.ok(
    protoCatalogDeps.includes("worldcore.world.TownTierRules"),
    "web-backend.routes.adminSpawnPoints.protoCatalogOps should depend on worldcore.world.TownTierRules",
  );
});
