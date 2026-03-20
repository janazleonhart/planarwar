// worldcore/test/contract_adminFrontendPageRouteRegistryParity.test.ts
// Contract guard: each live routed admin page in App.tsx must have a matching
// WebFrontendRegistry service entry by file path, and that entry must explicitly
// advertise the routed /admin path.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type RegistryEntry = {
  path?: string;
  provides?: string[] | string;
  notes?: string[] | string;
};

function repoRootFromDistTestDir(): string {
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function parseAdminRoutePages(appSrc: string): Array<{ route: string; pagePath: string; component: string }> {
  const importMap = new Map<string, string>();
  const importRe = /import\s+\{\s*(\w+)\s*\}\s+from\s+["']\.\/pages\/(\w+)["'];/g;
  for (const match of appSrc.matchAll(importRe)) {
    importMap.set(match[1], `web-frontend/pages/${match[2]}.tsx`);
  }

  const routes: Array<{ route: string; pagePath: string; component: string }> = [];
  const routeRe = /if\s*\(\s*pathname\s*(?:===|\.startsWith)\s*\(["'](\/admin(?:\/[^"']+)*)["']\)\s*\)\s*return\s+adminWrap\(<(\w+)/g;
  for (const match of appSrc.matchAll(routeRe)) {
    const route = match[1];
    const component = match[2];
    const pagePath = importMap.get(component);
    assert.ok(pagePath, `Could not resolve page import for routed admin component: ${component}`);
    routes.push({ route, pagePath, component });
  }

  return routes;
}

function entryMentionsRoute(entry: RegistryEntry, route: string): boolean {
  const values = [
    ...(Array.isArray(entry.provides) ? entry.provides : entry.provides ? [entry.provides] : []),
    ...(Array.isArray(entry.notes) ? entry.notes : entry.notes ? [entry.notes] : []),
  ];
  return values.some((value) => value.includes(route));
}

test("[contract] routed admin frontend pages stay explicit in registry route metadata", () => {
  const repoRoot = repoRootFromDistTestDir();
  const appPath = path.join(repoRoot, "web-frontend", "App.tsx");
  const registryPath = path.join(repoRoot, "web-frontend", "WebFrontendRegistry.json");

  const appSrc = readTextOrFail(appPath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    services?: Record<string, RegistryEntry>;
  };

  const routedPages = parseAdminRoutePages(appSrc);
  assert.ok(routedPages.length > 0, "Expected App.tsx to expose at least one routed /admin page");

  const services = registry.services ?? {};
  for (const routed of routedPages) {
    const matched = Object.entries(services).find(([, entry]) => entry.path === routed.pagePath);
    assert.ok(
      matched,
      `WebFrontendRegistry.json should contain a service entry for routed admin page file: ${routed.pagePath}`,
    );

    const [serviceName, entry] = matched;
    assert.ok(
      entryMentionsRoute(entry, routed.route),
      `Registry service ${serviceName} should explicitly mention routed admin path ${routed.route} in provides/notes`,
    );
  }
});
