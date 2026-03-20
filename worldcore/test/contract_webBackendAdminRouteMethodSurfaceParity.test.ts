// worldcore/test/contract_webBackendAdminRouteMethodSurfaceParity.test.ts
// Contract guard: mounted web-backend admin route method surfaces stay aligned with registry provides.
// Structural/regex-based: avoids starting Express or touching DB/service dependencies.
//
// Why this exists:
// - contract_webBackendAdminSurfaceRegistryParity.test.ts verifies each mounted admin family is represented.
// - This guard goes one level deeper and verifies the literal method/subpath surface declared in the
//   mounted route file is still admitted by the registry's provides list.
//
// Scope intentionally stays bounded to literal .get/.post/.put/.delete("/path") declarations inside
// the mounted admin route families from web-backend/index.ts.

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
};

function resolveRepoRoot(): string {
  const fromDist = path.resolve(__dirname, "../../..");
  if (fs.existsSync(path.join(fromDist, "web-backend", "index.ts"))) return fromDist;

  const fromSource = path.resolve(__dirname, "../..");
  if (fs.existsSync(path.join(fromSource, "web-backend", "index.ts"))) return fromSource;

  return fromDist;
}

function readTextOrFail(filePath: string): string {
  assert.ok(fs.existsSync(filePath), `Missing expected file: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function parseMountedAdminFamilies(indexSrc: string): MountedRouteFamily[] {
  const imports = new Map<string, string>();
  const importRe = /import\s+(?:\{\s*)?(\w+)(?:\s*\})?\s+from\s+["'](\.\/routes\/[A-Za-z0-9_/-]+)["'];/g;
  for (const match of indexSrc.matchAll(importRe)) {
    imports.set(match[1], match[2].replace(/^\.\//, "web-backend/") + ".ts");
  }

  const mounted: MountedRouteFamily[] = [];
  const mountRe = /app\.use\(\s*["'](\/api\/admin(?:\/[a-z_]+)*)["']\s*,\s*maybeRequireAdmin\(\s*["']\1["']\s*\)\s*,\s*(\w+)\s*\)/g;
  for (const match of indexSrc.matchAll(mountRe)) {
    const mount = match[1];
    const routerName = match[2];
    const routePath = imports.get(routerName);
    assert.ok(routePath, `Could not resolve import path for mounted admin router: ${routerName}`);
    mounted.push({ mount, routePath });
  }

  return mounted.sort((a, b) => a.mount.localeCompare(b.mount));
}

function parseLiteralMethodSurface(routeSrc: string, mount: string): string[] {
  const provides: string[] = [];
  const methodRe = /\.(get|post|put|delete)\("([^"]*)"/g;
  for (const match of routeSrc.matchAll(methodRe)) {
    const method = match[1].toUpperCase();
    const subpath = match[2];
    const fullPath = `${mount}${subpath === "/" ? "" : subpath}`;
    provides.push(`${method} ${fullPath}`);
  }
  return [...new Set(provides)].sort();
}

function registryProvidesSurface(provides: string[], expected: string): boolean {
  return provides.some((entry) => entry === expected || entry.startsWith(`${expected} `) || entry.startsWith(`${expected} (`));
}

test("[contract] mounted web-backend admin route method surfaces stay registry-aligned", () => {
  const repoRoot = resolveRepoRoot();
  const indexPath = path.join(repoRoot, "web-backend", "index.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const indexSrc = readTextOrFail(indexPath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as { services?: Record<string, RegistryEntry> };

  const mounted = parseMountedAdminFamilies(indexSrc);
  assert.ok(mounted.length > 0, "Expected at least one maybeRequireAdmin-gated /api/admin mount in web-backend/index.ts");

  const services = registry.services ?? {};

  for (const family of mounted) {
    const matched = Object.entries(services).find(([, entry]) => entry.path === family.routePath);
    assert.ok(matched, `WebBackendRegistry.json should contain a service entry for mounted admin route file: ${family.routePath}`);

    const [serviceName, entry] = matched;
    const routeSrc = readTextOrFail(path.join(repoRoot, family.routePath));
    const expectedProvides = parseLiteralMethodSurface(routeSrc, family.mount);
    assert.ok(expectedProvides.length > 0, `Expected mounted admin route file to expose at least one literal route: ${family.routePath}`);

    const registryProvides = entry.provides ?? [];
    for (const expected of expectedProvides) {
      assert.ok(
        registryProvidesSurface(registryProvides, expected),
        `Registry service ${serviceName} should document ${expected}`,
      );
    }
  }
});
