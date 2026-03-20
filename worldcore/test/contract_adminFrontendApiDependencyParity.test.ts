// worldcore/test/contract_adminFrontendApiDependencyParity.test.ts
// Contract guard: admin frontend pages with literal /api/admin/... usage must
// declare dependsOn entries for the matching backend admin route family.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type RegistryEntry = {
  path?: string;
  dependsOn?: string[] | string;
  provides?: string[] | string;
};

function repoRoot(): string {
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function listAdminPageFiles(pagesDir: string): string[] {
  return fs
    .readdirSync(pagesDir)
    .filter((name) => /^Admin.*Page\.tsx$/.test(name))
    .map((name) => path.join(pagesDir, name));
}

function normalizeAdminFamily(literal: string): string {
  let value = literal.trim();
  value = value.replace(/\$\{[^}]+\}/g, "");
  value = value.split("?")[0] ?? value;
  value = value.split("#")[0] ?? value;
  value = value.replace(/\/+$|\s+$/g, "");
  const parts = value.split("/").filter(Boolean);
  assert.ok(parts[0] === "api" && parts[1] === "admin", `Expected admin API literal, got: ${literal}`);
  assert.ok(parts.length >= 3, `Expected admin family segment in literal: ${literal}`);
  return `/${parts.slice(0, 3).join("/")}`;
}

function findLiteralAdminFamilies(pageSrc: string): string[] {
  const set = new Set<string>();
  const literalRe = /(["'`])(\/api\/admin\/[A-Za-z0-9_\-/${}.?=&]+)\1/g;
  for (const match of pageSrc.matchAll(literalRe)) {
    set.add(normalizeAdminFamily(match[2]));
  }
  return [...set].sort();
}

function asArray(value: string[] | string | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function findFrontendServiceByPath(
  services: Record<string, RegistryEntry>,
  relativePath: string,
): [string, RegistryEntry] | undefined {
  return Object.entries(services).find(([, entry]) => entry.path === relativePath);
}

function findBackendServiceForFamily(
  services: Record<string, RegistryEntry>,
  family: string,
): [string, RegistryEntry] | undefined {
  return Object.entries(services).find(([, entry]) =>
    asArray(entry.provides).some((value) => value.includes(` ${family}`) || value.startsWith(family)),
  );
}

test("[contract] admin frontend pages with literal admin API usage declare backend route dependencies", () => {
  const root = repoRoot();
  const pagesDir = path.join(root, "web-frontend", "pages");
  const frontendRegistryPath = path.join(root, "web-frontend", "WebFrontendRegistry.json");
  const backendRegistryPath = path.join(root, "web-backend", "WebBackendRegistry.json");

  const frontendRegistry = JSON.parse(readTextOrFail(frontendRegistryPath)) as {
    services?: Record<string, RegistryEntry>;
  };
  const backendRegistry = JSON.parse(readTextOrFail(backendRegistryPath)) as {
    services?: Record<string, RegistryEntry>;
  };

  const frontServices = frontendRegistry.services ?? {};
  const backServices = backendRegistry.services ?? {};

  let checkedFamilies = 0;
  for (const pagePath of listAdminPageFiles(pagesDir)) {
    const pageSrc = readTextOrFail(pagePath);
    const families = findLiteralAdminFamilies(pageSrc);
    if (families.length === 0) continue;

    const relativePagePath = path.relative(root, pagePath).replace(/\\/g, "/");
    const frontendService = findFrontendServiceByPath(frontServices, relativePagePath);
    assert.ok(
      frontendService,
      `WebFrontendRegistry.json should contain a service entry for admin page file: ${relativePagePath}`,
    );

    const [frontendServiceName, frontendEntry] = frontendService;
    const dependsOn = asArray(frontendEntry.dependsOn);

    for (const family of families) {
      const backendService = findBackendServiceForFamily(backServices, family);
      assert.ok(
        backendService,
        `WebBackendRegistry.json should contain a service entry documenting admin family: ${family}`,
      );
      const [backendServiceName] = backendService;
      assert.ok(
        dependsOn.includes(backendServiceName),
        `Frontend registry service ${frontendServiceName} should depend on ${backendServiceName} because ${relativePagePath} calls ${family}`,
      );
      checkedFamilies += 1;
    }
  }

  assert.ok(checkedFamilies > 0, "Expected to check at least one literal admin API family dependency");
});
