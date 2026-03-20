// worldcore/test/contract_adminTestFixturesSurfaceRegistryParity.test.ts
// Contract guard: admin test-fixture route surface stays aligned with registry truth.
//
// Structural/regex-based: avoids spinning up Express or touching the DB.
// Asserts:
// - web-backend/routes/adminTestFixtures.ts exposes the expected safe endpoints
// - WebBackendRegistry.json documents the same live endpoint surface

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

function mustContain(haystack: string, needle: string, msg: string): void {
  assert.ok(haystack.includes(needle), msg);
}

test("[contract] admin test-fixtures route surface stays registry-aligned", () => {
  const repoRoot = repoRootFromDistTestDir();
  const routePath = path.join(repoRoot, "web-backend", "routes", "adminTestFixtures.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const routeSrc = readTextOrFail(routePath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    services?: Record<string, { provides?: string[]; notes?: string[] }>;
  };

  const expectedRouteSurface = [
    { method: "get", subpath: "/ping", registry: "GET /api/admin/test_fixtures/ping" },
    { method: "post", subpath: "/ping", registry: "POST /api/admin/test_fixtures/ping" },
    { method: "get", subpath: "/time", registry: "GET /api/admin/test_fixtures/time" },
    { method: "get", subpath: "/echo_headers", registry: "GET /api/admin/test_fixtures/echo_headers" },
    { method: "get", subpath: "/db_counts", registry: "GET /api/admin/test_fixtures/db_counts" },
  ] as const;

  for (const endpoint of expectedRouteSurface) {
    mustContain(
      routeSrc,
      `router.${endpoint.method}("${endpoint.subpath}"`,
      `adminTestFixtures route should expose ${endpoint.method.toUpperCase()} ${endpoint.subpath}`,
    );
  }

  mustContain(
    routeSrc,
    'await db.query("SELECT 1")',
    'adminTestFixtures db_counts should keep the explicit read-only DB connectivity probe',
  );

  const entry = registry.services?.["web-backend.routes.adminTestFixtures"];
  assert.ok(entry, "WebBackendRegistry.json should contain web-backend.routes.adminTestFixtures");

  const provides = entry.provides ?? [];
  for (const endpoint of expectedRouteSurface) {
    mustContain(
      provides.join("\n"),
      endpoint.registry,
      `WebBackendRegistry.json should document ${endpoint.registry}`,
    );
  }

  const notes = (entry.notes ?? []).join("\n");
  mustContain(notes, "Must not mutate persistent world state", "Registry notes should preserve the non-mutating safety invariant");
  mustContain(notes, "Mounted at /api/admin/test_fixtures", "Registry notes should preserve the mounted base path");
});
