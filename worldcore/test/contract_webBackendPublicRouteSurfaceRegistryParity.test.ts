// worldcore/test/contract_webBackendPublicRouteSurfaceRegistryParity.test.ts
// Contract guard: mounted non-admin web-backend route families stay registry-represented.
// Structural/regex-based: avoids spinning up Express or touching DB/service dependencies.
// Asserts:
// - each app.use("/api/...", router) mount in web-backend/server/routeGroups.ts has a matching registry service by path
// - each matching registry entry mentions the mounted /api/... base path in provides/notes/owns

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type RegistryEntry = {
  path?: string;
  notes?: string[] | string;
  provides?: string[];
  owns?: string[];
};

type MountedRouteFamily = {
  mount: string;
  routePath: string;
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
    mounted.push({ mount, routePath });
  }

  return mounted.sort((a, b) => a.mount.localeCompare(b.mount));
}

function entryMentionsMount(entry: RegistryEntry, mount: string): boolean {
  const haystacks = [
    ...(entry.owns ?? []),
    ...(entry.provides ?? []),
    ...(Array.isArray(entry.notes) ? entry.notes : entry.notes ? [entry.notes] : []),
  ];
  return haystacks.some((value) => value.includes(mount));
}

test("[contract] mounted web-backend public route families stay registry-represented", () => {
  const repoRoot = resolveRepoRoot();
  const routeGroupsPath = path.join(repoRoot, "web-backend", "server", "routeGroups.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const routeGroupsSrc = readTextOrFail(routeGroupsPath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as { services?: Record<string, RegistryEntry> };

  const mounted = parseMountedPublicFamilies(routeGroupsSrc);
  assert.ok(mounted.length > 0, "Expected at least one mounted non-admin /api route in web-backend/server/routeGroups.ts");

  const services = registry.services ?? {};

  for (const family of mounted) {
    const matched = Object.entries(services).find(([, entry]) => entry.path === family.routePath);
    assert.ok(matched, `WebBackendRegistry.json should contain a service entry for mounted public route file: ${family.routePath}`);

    const [serviceName, entry] = matched;
    assert.ok(
      entryMentionsMount(entry, family.mount),
      `Registry service ${serviceName} should mention mounted public base path ${family.mount} in owns/provides/notes`,
    );
  }
});
