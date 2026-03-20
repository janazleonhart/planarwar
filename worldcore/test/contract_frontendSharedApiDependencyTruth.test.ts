//worldcore/test/contract_frontendSharedApiDependencyTruth.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type RegistryEntry = {
  path?: string;
  dependsOn?: string[] | string;
  provides?: string[] | string;
};

type RegistryMap = Record<string, RegistryEntry>;

function repoRoot(): string {
  const candidates = [
    path.resolve(__dirname, "../.."),
    path.resolve(__dirname, "../../.."),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "web-frontend", "lib", "api.ts")) &&
      fs.existsSync(path.join(candidate, "web-frontend", "WebFrontendRegistry.json")) &&
      fs.existsSync(path.join(candidate, "web-backend", "WebBackendRegistry.json"))
    ) {
      return candidate;
    }
  }
  assert.fail(`Could not resolve repo root from ${__dirname}`);
}

function readJsonOrFail<T>(p: string): T {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function asArray(value: string[] | string | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const EXPECTATIONS = [
  { family: "/api/me", backendService: "web-backend.routes.me" },
  { family: "/api/public_infrastructure", backendService: "web-backend.routes.publicInfrastructure" },
  { family: "/api/city_mud_bridge", backendService: "web-backend.routes.cityMudBridge" },
  { family: "/api/missions", backendService: "web-backend.routes.missions" },
  { family: "/api/world_consequences", backendService: "web-backend.routes.worldConsequences" },
  { family: "/api/tech", backendService: "web-backend.routes.tech" },
  { family: "/api/city", backendService: "web-backend.routes.city" },
  { family: "/api/admin/vendor_economy", backendService: "web-backend.routes.adminVendorEconomy" },
] as const;

test("[contract] shared frontend api helper declares backend route dependencies", () => {
  const root = repoRoot();
  const apiPath = path.join(root, "web-frontend", "lib", "api.ts");
  const frontendRegistryPath = path.join(root, "web-frontend", "WebFrontendRegistry.json");
  const backendRegistryPath = path.join(root, "web-backend", "WebBackendRegistry.json");

  const apiSource = fs.readFileSync(apiPath, "utf8");
  const frontendRegistry = readJsonOrFail<{ services?: RegistryMap }>(frontendRegistryPath);
  const backendRegistry = readJsonOrFail<{ services?: RegistryMap }>(backendRegistryPath);

  const frontendService = frontendRegistry.services?.["web-frontend.lib.api"];
  assert.ok(frontendService, "WebFrontendRegistry.json should contain web-frontend.lib.api");
  assert.equal(frontendService.path, "web-frontend/lib/api.ts", "web-frontend.lib.api should point at web-frontend/lib/api.ts");

  const dependsOn = asArray(frontendService.dependsOn);

  for (const expectation of EXPECTATIONS) {
    assert.ok(
      apiSource.includes(expectation.family),
      `web-frontend/lib/api.ts should still contain literal usage for ${expectation.family}`,
    );

    const backendService = backendRegistry.services?.[expectation.backendService];
    assert.ok(backendService, `WebBackendRegistry.json should contain ${expectation.backendService}`);

    const provides = asArray(backendService.provides);
    assert.ok(
      provides.some((entry) => entry.includes(expectation.family)),
      `${expectation.backendService} should document ${expectation.family}`,
    );

    assert.ok(
      dependsOn.includes(expectation.backendService),
      `web-frontend.lib.api should depend on ${expectation.backendService} because lib/api.ts calls ${expectation.family}`,
    );
  }
});
