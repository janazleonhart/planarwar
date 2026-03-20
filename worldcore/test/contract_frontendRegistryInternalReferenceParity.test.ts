//worldcore/test/contract_frontendRegistryInternalReferenceParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(startDir: string): string {
  let cur = startDir;
  for (let i = 0; i < 8; i += 1) {
    const pkg = path.join(cur, "package.json");
    const frontend = path.join(cur, "web-frontend", "WebFrontendRegistry.json");
    if (fs.existsSync(pkg) && fs.existsSync(frontend)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(`Unable to locate repo root from ${startDir}`);
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

test("[contract] frontend registry internal references and App direct imports remain registry-aligned", () => {
  const repoRoot = findRepoRoot(__dirname);
  const registryPath = path.join(repoRoot, "web-frontend", "WebFrontendRegistry.json");
  const appPath = path.join(repoRoot, "web-frontend", "App.tsx");
  const registry = readJson(registryPath);
  const services = registry.services ?? {};
  const serviceIds = new Set<string>(Object.keys(services));
  const appSource = fs.readFileSync(appPath, "utf8");

  for (const [serviceId, service] of Object.entries<any>(services)) {
    for (const dep of service.dependsOn ?? []) {
      if (typeof dep === "string" && dep.startsWith("web-frontend.")) {
        assert.ok(
          serviceIds.has(dep),
          `${serviceId} dependsOn missing frontend registry service ${dep}`,
        );
      }
    }
  }

  const expectedDirectImports = [
    "web-frontend/pages/AdminSpawnPointsPage.tsx",
    "web-frontend/pages/AdminQuestsPage.tsx",
    "web-frontend/pages/AdminNpcsPage.tsx",
    "web-frontend/pages/AdminItemsPage.tsx",
    "web-frontend/pages/AdminSpellsPage.tsx",
    "web-frontend/pages/AdminAbilitiesPage.tsx",
    "web-frontend/pages/AdminVendorEconomyPage.tsx",
    "web-frontend/pages/AdminVendorAuditPage.tsx",
    "web-frontend/pages/AdminHubPage.tsx",
    "web-frontend/pages/AdminMotherBrainPage.tsx",
    "web-frontend/pages/AdminHeartbeatsPage.tsx",
    "web-frontend/components/admin/AdminTheme.tsx",
    "web-frontend/pages/CityShellPage.tsx",
    "web-frontend/pages/ModeHubPage.tsx",
  ];

  const registryPaths = new Set<string>(Object.values<any>(services).map((s) => s.path).filter(Boolean));
  for (const relPath of expectedDirectImports) {
    assert.match(appSource, new RegExp(relPath.replace("web-frontend/", "./").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\.tsx$/, "")), `App.tsx should still import ${relPath}`);
    assert.ok(registryPaths.has(relPath), `WebFrontendRegistry.json should contain a service for App.tsx direct import path ${relPath}`);
  }
});
