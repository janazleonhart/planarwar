// worldcore/test/contract_webBackendPublicRouteMethodSurfaceParity.test.ts
// Contract guard: mounted non-admin web-backend route method surfaces stay registry-represented.
// Structural/regex-based: avoids spinning up Express or touching DB/service dependencies.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type RegistryEntry = {
  path?: string;
  provides?: string[];
};

type MountedRouteFamily = {
  mount: string;
  routePath: string;
  routerName: string;
};

type RouteDecl = {
  method: string;
  subpath: string;
};

function resolveRepoRoot(): string {
  const fromDist = path.resolve(__dirname, "../../..");
  if (fs.existsSync(path.join(fromDist, "web-backend", "server", "routeGroups.ts"))) return fromDist;

  const fromSource = path.resolve(__dirname, "../..");
  if (fs.existsSync(path.join(fromSource, "web-backend", "server", "routeGroups.ts"))) return fromSource;

  return fromDist;
}

function readTextOrFail(filePath: string): string {
  assert.ok(fs.existsSync(filePath), `Missing expected file: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function parseMountedPublicFamilies(routeGroupsSrc: string): MountedRouteFamily[] {
  const imports = new Map<string, string>();
  const importRe = /import\s+(?:\{\s*)?(\w+)(?:\s*\})?\s+from\s+["'](\.\.\/routes\/[A-Za-z0-9_/-]+)["'];/g;
  for (const match of routeGroupsSrc.matchAll(importRe)) {
    const routerName = match[1];
    const importPath = match[2].replace(/^\.\.\//, "web-backend/");
    imports.set(routerName, `${importPath}.ts`);
  }

  const mounted: MountedRouteFamily[] = [];
  const mountRe = /app\.use\(\s*["'](\/api\/(?!admin)[a-z_]+)["']\s*,\s*(\w+)\s*\)/g;
  for (const match of routeGroupsSrc.matchAll(mountRe)) {
    const mount = match[1];
    const routerName = match[2];
    const routePath = imports.get(routerName);
    assert.ok(routePath, `Could not resolve import path for mounted public router: ${routerName}`);
    mounted.push({ mount, routePath, routerName });
  }

  return mounted.sort((a, b) => a.mount.localeCompare(b.mount));
}

function parseRouteDeclarations(routeSrc: string, routerName: string): RouteDecl[] {
  const decls: RouteDecl[] = [];
  const routeRe = new RegExp(`${routerName.replace(/[$]/g, "\\$")}\\.(get|post|put|delete|patch)\\(\\s*["']([^"']+)["']`, "g");
  for (const match of routeSrc.matchAll(routeRe)) {
    decls.push({ method: match[1].toUpperCase(), subpath: match[2] });
  }

  if (decls.length > 0) return decls;

  const genericRe = /(\w+)\.(get|post|put|delete|patch)\(\s*["']([^"']+)["']/g;
  for (const match of routeSrc.matchAll(genericRe)) {
    if (match[1] !== "router") continue;
    decls.push({ method: match[2].toUpperCase(), subpath: match[3] });
  }
  return decls;
}

function normalizeMountedPath(mount: string, subpath: string): string {
  if (subpath === "/") return mount;
  return `${mount}${subpath}`;
}

test("[contract] mounted web-backend public route method surfaces stay registry-aligned", () => {
  const repoRoot = resolveRepoRoot();
  const routeGroupsPath = path.join(repoRoot, "web-backend", "server", "routeGroups.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const routeGroupsSrc = readTextOrFail(routeGroupsPath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as { services?: Record<string, RegistryEntry> };
  const services = registry.services ?? {};

  const mounted = parseMountedPublicFamilies(routeGroupsSrc);
  assert.ok(mounted.length > 0, "Expected at least one mounted non-admin /api route in web-backend/server/routeGroups.ts");

  for (const family of mounted) {
    const matched = Object.entries(services).find(([, entry]) => entry.path === family.routePath);
    assert.ok(matched, `WebBackendRegistry.json should contain a service entry for mounted public route file: ${family.routePath}`);

    const [serviceName, entry] = matched;
    const provides = new Set(entry.provides ?? []);
    const routeSrc = readTextOrFail(path.join(repoRoot, family.routePath));
    const decls = parseRouteDeclarations(routeSrc, family.routerName);
    assert.ok(decls.length > 0, `Expected route declarations in ${family.routePath}`);

    for (const decl of decls) {
      if (!decl.subpath.startsWith("/")) continue;
      const expected = `${decl.method} ${normalizeMountedPath(family.mount, decl.subpath)}`;
      assert.ok(provides.has(expected), `Registry service ${serviceName} should provide ${expected}`);
    }
  }
});
