//worldcore/test/contract_frontendLegacyAppApiDependencyTruth.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.resolve(current, "package.json");
    const worldcorePkg = path.resolve(current, "worldcore", "package.json");
    const webFrontendRegistry = path.resolve(current, "web-frontend", "WebFrontendRegistry.json");
    const webBackendRegistry = path.resolve(current, "web-backend", "WebBackendRegistry.json");
    if (fs.existsSync(candidate) && fs.existsSync(worldcorePkg) && fs.existsSync(webFrontendRegistry) && fs.existsSync(webBackendRegistry)) {
      return current;
    }
    current = path.resolve(current, "..");
  }
  throw new Error(`Unable to resolve repo root from ${startDir}`);
}

function normalizeApiFamily(raw: string): string {
  let value = raw.replace(/\$\{[^}]+\}/g, "");
  value = value.split("?")[0] ?? value;
  value = value.replace(/\/$/, "");

  const parts = value.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "api") {
    return value;
  }
  if (parts[1] === "auth") {
    return "/api/auth";
  }
  if (parts[1] === "characters") {
    return "/api/characters";
  }
  if (["items", "abilities", "spells"].includes(parts[1])) {
    return `/api/${parts[1]}`;
  }
  return value;
}

test("[contract] legacy App literal API usage declares backend route dependencies", () => {
  const repoRoot = findRepoRoot(__dirname);
  const appPath = path.join(repoRoot, "web-frontend", "App.tsx");
  const frontendRegistryPath = path.join(repoRoot, "web-frontend", "WebFrontendRegistry.json");
  const backendRegistryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const appSource = fs.readFileSync(appPath, "utf8");
  const frontendRegistry = JSON.parse(fs.readFileSync(frontendRegistryPath, "utf8"));
  const backendRegistry = JSON.parse(fs.readFileSync(backendRegistryPath, "utf8"));

  const frontendService = frontendRegistry.services["web-frontend.ui.app"];
  assert.ok(frontendService, "WebFrontendRegistry.json should contain web-frontend.ui.app");
  assert.equal(frontendService.path, "web-frontend/App.tsx", "web-frontend.ui.app should point at App.tsx");

  const literalMatches = [...appSource.matchAll(/\/api\/[A-Za-z0-9_/:?${}.-]+/g)].map((m) => normalizeApiFamily(m[0]));
  const families = new Set(literalMatches.filter((v) => ["/api/auth", "/api/characters", "/api/items", "/api/abilities", "/api/spells"].includes(v)));

  const expected = new Map<string, string>([
    ["/api/auth", "web-backend.routes.auth"],
    ["/api/characters", "web-backend.routes.characters"],
    ["/api/items", "web-backend.routes.items"],
    ["/api/abilities", "web-backend.routes.abilities"],
    ["/api/spells", "web-backend.routes.spells"],
  ]);

  for (const [family, serviceName] of expected.entries()) {
    assert.ok(families.has(family), `App.tsx should contain literal usage for ${family}`);
    const backendService = backendRegistry.services[serviceName];
    assert.ok(backendService, `WebBackendRegistry.json should contain ${serviceName}`);
    const provides = backendService.provides ?? [];
    assert.ok(provides.some((item: string) => item.startsWith(family)), `${serviceName} should document ${family}`);
    assert.ok(
      (frontendService.dependsOn ?? []).includes(serviceName),
      `web-frontend.ui.app should depend on ${serviceName} because App.tsx calls ${family}`,
    );
  }
});
