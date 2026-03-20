// worldcore/test/contract_webBackendAdminSurfaceRegistryParity.test.ts
// Contract guard: web-backend mounted admin route families stay aligned with registry truth.
//
// Structural/regex-based: avoids spinning up Express or touching any DB/service.
// Asserts:
// - each maybeRequireAdmin-gated /api/admin/* mount in web-backend/index.ts has a matching registry service by path
// - each matching registry entry mentions the mounted /api/admin/* base path in owns/provides/notes

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

type RegistryEntry = {
  path?: string;
  notes?: string[] | string;
  provides?: string[];
  owns?: string[];
};

function parseMountedAdminFamilies(indexSrc: string): Array<{ mount: string; routePath: string }> {
  const mounts: Array<{ mount: string; routePath: string }> = [];
  const importMap = new Map<string, string>();

  const importRe = /import\s+(?:\{\s*)?(\w+)(?:\s*\})?\s+from\s+["'](\.\/routes\/[A-Za-z0-9_/-]+)["'];/g;
  for (const match of indexSrc.matchAll(importRe)) {
    importMap.set(match[1], match[2].replace(/^\.\//, "web-backend/") + ".ts");
  }

  const mountRe = /app\.use\(\s*["'](\/api\/admin(?:\/[a-z_]+)*)["']\s*,\s*maybeRequireAdmin\(\s*["']\1["']\s*\)\s*,\s*(\w+)\s*\)/g;
  for (const match of indexSrc.matchAll(mountRe)) {
    const mount = match[1];
    const routerName = match[2];
    const routePath = importMap.get(routerName);
    assert.ok(routePath, `Could not resolve import path for mounted admin router: ${routerName}`);
    mounts.push({ mount, routePath });
  }

  return mounts.sort((a, b) => a.mount.localeCompare(b.mount));
}

function entryMentionsMount(entry: RegistryEntry, mount: string): boolean {
  const haystacks = [
    ...(entry.owns ?? []),
    ...(entry.provides ?? []),
    ...(Array.isArray(entry.notes) ? entry.notes : entry.notes ? [entry.notes] : []),
  ];
  return haystacks.some((value) => value.includes(mount));
}

test("[contract] mounted web-backend admin route families stay registry-represented", () => {
  const repoRoot = repoRootFromDistTestDir();
  const indexPath = path.join(repoRoot, "web-backend", "index.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const indexSrc = readTextOrFail(indexPath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    services?: Record<string, RegistryEntry>;
  };

  const mounts = parseMountedAdminFamilies(indexSrc);
  assert.ok(mounts.length > 0, "Expected at least one maybeRequireAdmin-gated /api/admin mount in web-backend/index.ts");

  const services = registry.services ?? {};

  for (const mounted of mounts) {
    const matched = Object.entries(services).find(([, entry]) => entry.path === mounted.routePath);
    assert.ok(
      matched,
      `WebBackendRegistry.json should contain a service entry for mounted admin route file: ${mounted.routePath}`,
    );

    const [serviceName, entry] = matched;
    assert.ok(
      entryMentionsMount(entry, mounted.mount),
      `Registry service ${serviceName} should mention mounted admin base path ${mounted.mount} in owns/provides/notes`,
    );
  }
});
