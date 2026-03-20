// worldcore/test/contract_frontendPlayerApiDependencyTruth.test.ts
// Contract guard: non-admin player-facing frontend pages that make literal
// /api/* calls must truthfully declare backend route dependencies.

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

function extractPlayerApiFamilies(source: string): string[] {
  const matches = source.match(/\/api\/[A-Za-z0-9_/${}.-]+/g) ?? [];
  const families = new Set<string>();
  for (const raw of matches) {
    if (raw.startsWith("/api/admin/")) continue;
    const withoutInterpolation = raw.replace(/\$\{[^}]+\}/g, "");
    const withoutQuery = withoutInterpolation.split("?")[0];
    const parts = withoutQuery.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    families.add(`/${parts[0]}/${parts[1]}`);
  }
  return [...families].sort();
}

function findFrontendServiceForPath(services: RegistryMap, relativePath: string): [string, RegistryEntry] {
  const match = Object.entries(services).find(([, entry]) => entry?.path === relativePath);
  assert.ok(match, `Missing frontend registry service for page: ${relativePath}`);
  return match as [string, RegistryEntry];
}

function findBackendDependencyForFamily(services: RegistryMap, family: string): string {
  const match = Object.entries(services).find(([, entry]) =>
    asArray(entry?.provides).some((provide) => provide.includes(family)),
  );
  assert.ok(match, `Missing backend registry service documenting player API family: ${family}`);
  return match![0];
}

test("[contract] player-facing frontend pages with literal API usage declare backend route dependencies", () => {
  const root = repoRoot();
  const frontendRegistryPath = path.join(root, "web-frontend", "WebFrontendRegistry.json");
  const backendRegistryPath = path.join(root, "web-backend", "WebBackendRegistry.json");
  const pagesDir = path.join(root, "web-frontend", "pages");

  const frontendRegistry = readJsonOrFail<{ services?: RegistryMap }>(frontendRegistryPath);
  const backendRegistry = readJsonOrFail<{ services?: RegistryMap }>(backendRegistryPath);
  const frontendServices = frontendRegistry.services ?? {};
  const backendServices = backendRegistry.services ?? {};

  const pageFiles = fs.readdirSync(pagesDir)
    .filter((name) => name.endsWith("Page.tsx") && !name.startsWith("Admin"))
    .sort();

  for (const pageFile of pageFiles) {
    const relativePath = path.posix.join("web-frontend/pages", pageFile);
    const fullPath = path.join(pagesDir, pageFile);
    const source = fs.readFileSync(fullPath, "utf8");
    const families = extractPlayerApiFamilies(source);
    if (families.length === 0) continue;

    const [serviceName, entry] = findFrontendServiceForPath(frontendServices, relativePath);
    const deps = asArray(entry.dependsOn);

    for (const family of families) {
      const backendService = findBackendDependencyForFamily(backendServices, family);
      assert.ok(
        deps.includes(backendService),
        `${serviceName} should depend on ${backendService} because ${relativePath} calls ${family}`,
      );
    }
  }
});
