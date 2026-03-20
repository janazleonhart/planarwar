//worldcore/test/contract_frontendCatalogDependencyTruth.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const here = __dirname;
  const candidates = [
    path.resolve(here, "../.."),
    path.resolve(here, "../../.."),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "web-frontend", "App.tsx")) &&
      fs.existsSync(path.join(candidate, "web-frontend", "WebFrontendRegistry.json")) &&
      fs.existsSync(path.join(candidate, "web-backend", "WebBackendRegistry.json"))
    ) {
      return candidate;
    }
  }
  throw new Error(`Could not resolve repo root from ${here}`);
}

test("[contract] frontend catalog API consumers declare backend catalog dependencies", () => {
  const repoRoot = resolveRepoRoot();
  const appPath = path.join(repoRoot, "web-frontend", "App.tsx");
  const frontendRegistryPath = path.join(repoRoot, "web-frontend", "WebFrontendRegistry.json");
  const backendRegistryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const appSource = fs.readFileSync(appPath, "utf8");
  const frontendRegistry = JSON.parse(fs.readFileSync(frontendRegistryPath, "utf8"));
  const backendRegistry = JSON.parse(fs.readFileSync(backendRegistryPath, "utf8"));

  const frontendService = frontendRegistry.services["web-frontend.ui.app"];
  assert.ok(frontendService, "WebFrontendRegistry.json should document web-frontend.ui.app");
  assert.equal(frontendService.path, "web-frontend/App.tsx", "web-frontend.ui.app should point at web-frontend/App.tsx");

  const backendServices = backendRegistry.services;
  const expectations = [
    {
      apiFamily: "/api/items",
      backendServiceId: "web-backend.routes.items",
      marker: "/api/items?ids=",
    },
    {
      apiFamily: "/api/abilities",
      backendServiceId: "web-backend.routes.abilities",
      marker: "/api/abilities?ids=",
    },
    {
      apiFamily: "/api/spells",
      backendServiceId: "web-backend.routes.spells",
      marker: "/api/spells?ids=",
    },
  ];

  for (const expectation of expectations) {
    assert.ok(
      appSource.includes(expectation.marker),
      `App.tsx should still contain literal catalog API usage for ${expectation.apiFamily}`,
    );

    const backendService = backendServices[expectation.backendServiceId];
    assert.ok(
      backendService,
      `WebBackendRegistry.json should contain ${expectation.backendServiceId} for ${expectation.apiFamily}`,
    );

    const backendProvides = Array.isArray(backendService.provides) ? backendService.provides : [];
    assert.ok(
      backendProvides.some((entry: string) => entry.includes(`GET ${expectation.apiFamily}`)),
      `${expectation.backendServiceId} should document GET ${expectation.apiFamily}`,
    );

    const dependsOn = Array.isArray(frontendService.dependsOn) ? frontendService.dependsOn : [];
    assert.ok(
      dependsOn.includes(expectation.backendServiceId),
      `web-frontend.ui.app should depend on ${expectation.backendServiceId} because App.tsx calls ${expectation.apiFamily}`,
    );
  }
});
