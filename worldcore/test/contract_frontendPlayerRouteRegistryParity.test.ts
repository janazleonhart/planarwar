//worldcore/test/contract_frontendPlayerRouteRegistryParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type RegistryEntry = {
  path?: string;
  provides?: string[] | string;
};

type RegistryMap = Record<string, RegistryEntry>;

function repoRoot(): string {
  const candidates = [
    path.resolve(__dirname, "../.."),
    path.resolve(__dirname, "../../.."),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "web-frontend", "WebFrontendRegistry.json"))) {
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

function findFrontendServiceForPath(services: RegistryMap, relativePath: string): [string, RegistryEntry] {
  const match = Object.entries(services).find(([, entry]) => entry?.path === relativePath);
  assert.ok(match, `Missing frontend registry service for page: ${relativePath}`);
  return match as [string, RegistryEntry];
}

test("[contract] player-facing routed pages remain registry-aligned", () => {
  const root = repoRoot();
  const appPath = path.join(root, "web-frontend", "App.tsx");
  const registryPath = path.join(root, "web-frontend", "WebFrontendRegistry.json");

  const appSource = fs.readFileSync(appPath, "utf8");
  const registry = readJsonOrFail<{ services?: RegistryMap }>(registryPath);
  const services = registry.services ?? {};

  assert.match(appSource, /<ModeHubPage\b/, "App.tsx should still render ModeHubPage for the launcher path");
  assert.match(appSource, /pathname === "\/"/, 'App.tsx should still treat "/" as the launcher route');

  const [modeHubServiceName, modeHubEntry] = findFrontendServiceForPath(services, "web-frontend/pages/ModeHubPage.tsx");
  assert.ok(
    asArray(modeHubEntry.provides).includes("route:/"),
    `${modeHubServiceName} should provide route:/ because App.tsx renders it for the launcher path`,
  );

  assert.match(appSource, /<CityShellPage\b/, "App.tsx should still render CityShellPage for /city paths");
  assert.match(appSource, /pathname\.startsWith\("\/city"\)/, 'App.tsx should still route "/city*" through CityShellPage');
  assert.match(appSource, /window\.location\.assign\("\/city\/me"\)/, 'App.tsx should still normalize "/city" to "/city/me"');

  const [cityShellServiceName, cityShellEntry] = findFrontendServiceForPath(services, "web-frontend/pages/CityShellPage.tsx");
  for (const route of ["route:/city", "route:/city/me", "route:/city/operations"]) {
    assert.ok(
      asArray(cityShellEntry.provides).includes(route),
      `${cityShellServiceName} should provide ${route}`,
    );
  }

  const [meServiceName, meEntry] = findFrontendServiceForPath(services, "web-frontend/pages/MePage.tsx");
  assert.ok(asArray(meEntry.provides).includes("route:/city/me"), `${meServiceName} should provide route:/city/me`);

  const [opsServiceName, opsEntry] = findFrontendServiceForPath(services, "web-frontend/pages/OperationsPage.tsx");
  assert.ok(
    asArray(opsEntry.provides).includes("route:/city/operations"),
    `${opsServiceName} should provide route:/city/operations`,
  );
});
