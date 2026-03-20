// worldcore/test/contract_frontendPlayerApiDependencyTruth.test.ts
// Contract guard: key player-facing frontend pages must truthfully declare
// backend route dependencies for their live API-driven behavior.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type RegistryEntry = {
  path?: string;
  dependsOn?: string[] | string;
};

function repoRoot(): string {
  return path.resolve(__dirname, "../../..");
}

function readJsonOrFail<T>(p: string): T {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function asArray(value: string[] | string | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

test("[contract] player-facing frontend pages declare core backend route dependencies", () => {
  const root = repoRoot();
  const registryPath = path.join(root, "web-frontend", "WebFrontendRegistry.json");
  const registry = readJsonOrFail<{ services?: Record<string, RegistryEntry> }>(registryPath);
  const services = registry.services ?? {};

  const expected: Record<string, { path: string; deps: string[] }> = {
    "web-frontend.pages.me": {
      path: "web-frontend/pages/MePage.tsx",
      deps: [
        "web-backend.routes.me",
        "web-backend.routes.city",
        "web-backend.routes.publicInfrastructure",
        "web-backend.routes.cityMudBridge",
        "web-backend.routes.missions",
        "web-backend.routes.tech",
        "web-backend.routes.buildings",
        "web-backend.routes.warfront",
        "web-backend.routes.armies",
        "web-backend.routes.garrisons",
        "web-backend.routes.heroes",
        "web-backend.routes.workshop",
        "web-backend.routes.policies",
      ],
    },
    "web-frontend.pages.operations": {
      path: "web-frontend/pages/OperationsPage.tsx",
      deps: [
        "web-backend.routes.me",
        "web-backend.routes.city",
      ],
    },
  };

  for (const [serviceName, expectation] of Object.entries(expected)) {
    const entry = services[serviceName];
    assert.ok(entry, `Missing frontend registry entry: ${serviceName}`);
    assert.equal(entry.path, expectation.path, `${serviceName} should point at ${expectation.path}`);
    const deps = asArray(entry.dependsOn);
    for (const dep of expectation.deps) {
      assert.ok(
        deps.includes(dep),
        `${serviceName} should declare backend dependency ${dep}`,
      );
    }
  }
});
