// worldcore/test/contract_adminVendorEconomySurfaceRegistryParity.test.ts
// Contract guard: admin vendor economy scenario/report routes remain registry-aligned.
//
// Structural/regex-based: avoids spinning up Express or touching the DB.
// Asserts:
// - web-backend/routes/adminVendorEconomy.ts exposes the expected scenario/report endpoints
// - WebBackendRegistry.json documents the same live endpoint surface

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const fromHere = path.resolve(__dirname, "../../..");
  const sourcePath = path.join(fromHere, "web-backend", "routes", "adminVendorEconomy.ts");
  if (fs.existsSync(sourcePath)) return fromHere;

  const fallback = path.resolve(__dirname, "../..");
  const fallbackPath = path.join(fallback, "web-backend", "routes", "adminVendorEconomy.ts");
  if (fs.existsSync(fallbackPath)) return fallback;

  return fromHere;
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function mustContain(haystack: string, needle: string, msg: string): void {
  assert.ok(haystack.includes(needle), msg);
}

test("[contract] admin vendor economy scenario/report routes remain registry-aligned", () => {
  const repoRoot = resolveRepoRoot();
  const routePath = path.join(repoRoot, "web-backend", "routes", "adminVendorEconomy.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const routeSrc = readTextOrFail(routePath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    services?: Record<string, { provides?: string[]; notes?: string[] }>;
  };

  const expectedRouteSurface = [
    {
      routeNeedle: 'adminVendorEconomyRouter.get("/bridge_runtime_guarded_log"',
      registry: 'GET /api/admin/vendor_economy/bridge_runtime_guarded_log',
      label: 'GET /bridge_runtime_guarded_log',
    },
    {
      routeNeedle: 'adminVendorEconomyRouter.get("/scenarios"',
      registry: 'GET /api/admin/vendor_economy/scenarios',
      label: 'GET /scenarios',
    },
    {
      routeNeedle: 'adminVendorEconomyRouter.get("/scenarios/export"',
      registry: 'GET /api/admin/vendor_economy/scenarios/export',
      label: 'GET /scenarios/export',
    },
    {
      routeNeedle: 'adminVendorEconomyRouter.post("/bridge_runtime_guarded"',
      registry: 'POST /api/admin/vendor_economy/bridge_runtime_guarded',
      label: 'POST /bridge_runtime_guarded',
    },
  ] as const;

  for (const endpoint of expectedRouteSurface) {
    mustContain(
      routeSrc,
      endpoint.routeNeedle,
      `adminVendorEconomy route should expose ${endpoint.label}`,
    );
  }

  mustContain(
    routeSrc,
    'readVendorScenarioReportFromFile(VENDOR_SCENARIO_LOG_PATH',
    'adminVendorEconomy route should keep scenario report file reads explicit',
  );
  mustContain(
    routeSrc,
    'renderVendorScenarioReportCsv(report.entries)',
    'adminVendorEconomy route should keep CSV export wiring explicit',
  );

  const entry = registry.services?.["web-backend.routes.adminVendorEconomy"];
  assert.ok(entry, "WebBackendRegistry.json should contain web-backend.routes.adminVendorEconomy");

  const provides = entry.provides ?? [];
  for (const endpoint of expectedRouteSurface) {
    mustContain(
      provides.join("\n"),
      endpoint.registry,
      `WebBackendRegistry.json should document ${endpoint.registry}`,
    );
  }

  const notes = (entry.notes ?? []).join("\n");
  mustContain(
    notes,
    'Mounted at /api/admin/vendor_economy',
    'Registry notes should preserve the mounted admin vendor economy base path',
  );
  mustContain(
    notes,
    'v1.1 adds GET /api/admin/vendor_economy/bridge_runtime_guarded_log',
    'Registry notes should preserve guarded-log scenario audit history',
  );
});
