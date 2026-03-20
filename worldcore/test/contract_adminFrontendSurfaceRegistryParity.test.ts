// worldcore/test/contract_adminFrontendSurfaceRegistryParity.test.ts
// Contract guard: web-frontend admin surface registry should match the live routed/admin-hub pages.
//
// Structural/regex-based: avoids spinning up Vite/React.
// Asserts:
// - WebFrontendRegistry.json conventions.adminPages includes every current /admin page routed by App.tsx
// - AdminHubPage links only to pages that are both routed and registry-listed
//
// IMPORTANT: Keep this broad and stability-focused. We care about navigable admin truth,
// not the exact JSX structure.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function parseAdminRoutesFromApp(appSrc: string): string[] {
  const routes = new Set<string>();
  const routeRe = /pathname\.startsWith\("(\/admin(?:\/[^"]+)?)"\)/g;
  for (const match of appSrc.matchAll(routeRe)) {
    routes.add(match[1]);
  }
  return [...routes].sort();
}

function parseAdminHubPaths(hubSrc: string): string[] {
  const paths = new Set<string>();
  const pathRe = /path:\s*"(\/admin(?:\/[^"]+)?)"/g;
  for (const match of hubSrc.matchAll(pathRe)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

test("[contract] admin frontend routes, hub links, and registry adminPages stay aligned", () => {
  const repoRoot = repoRootFromDistTestDir();

  const registryPath = path.join(repoRoot, "web-frontend", "WebFrontendRegistry.json");
  const appPath = path.join(repoRoot, "web-frontend", "App.tsx");
  const hubPath = path.join(repoRoot, "web-frontend", "pages", "AdminHubPage.tsx");

  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    conventions?: { adminPages?: string[] };
  };
  const appSrc = readTextOrFail(appPath);
  const hubSrc = readTextOrFail(hubPath);

  const registryPages = new Set((registry.conventions?.adminPages ?? []).filter((p) => p.startsWith("/admin")));
  const appRoutes = parseAdminRoutesFromApp(appSrc);
  const hubPaths = parseAdminHubPaths(hubSrc);

  assert.ok(appRoutes.length > 0, "Expected App.tsx to expose at least one /admin route");
  assert.ok(hubPaths.length > 0, "Expected AdminHubPage.tsx to list at least one /admin path");

  for (const route of appRoutes) {
    assert.ok(
      registryPages.has(route),
      `WebFrontendRegistry.json conventions.adminPages should include live admin route: ${route}`,
    );
  }

  for (const hubPath of hubPaths) {
    assert.ok(appRoutes.includes(hubPath), `AdminHubPage should only link to live routed admin pages: ${hubPath}`);
    assert.ok(
      registryPages.has(hubPath),
      `WebFrontendRegistry.json conventions.adminPages should include AdminHub page: ${hubPath}`,
    );
  }
});
