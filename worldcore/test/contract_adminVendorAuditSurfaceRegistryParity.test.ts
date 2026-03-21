// worldcore/test/contract_adminVendorAuditSurfaceRegistryParity.test.ts
// Contract guard: admin vendor audit route surface stays registry-aligned.
//
// Structural/regex-based: avoids spinning up Express or touching the DB.
// Asserts:
// - web-backend/routes/adminVendorAudit.ts exposes the expected JSON + CSV endpoints
// - WebBackendRegistry.json documents the same live endpoint surface
// - pagination/export safety rails and newest-first ordering remain explicit

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const fromHere = path.resolve(__dirname, "../../..");
  const sourcePath = path.join(fromHere, "web-backend", "routes", "adminVendorAudit.ts");
  if (fs.existsSync(sourcePath)) return fromHere;

  const fallback = path.resolve(__dirname, "../..");
  const fallbackPath = path.join(fallback, "web-backend", "routes", "adminVendorAudit.ts");
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

test("[contract] admin vendor audit route surface stays registry-aligned", () => {
  const repoRoot = resolveRepoRoot();
  const routePath = path.join(repoRoot, "web-backend", "routes", "adminVendorAudit.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const routeSrc = readTextOrFail(routePath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    services?: Record<string, { provides?: string[]; notes?: string[] }>;
  };

  const expectedRouteSurface = [
    {
      routeNeedle: 'adminVendorAuditRouter.get("/"',
      registry: 'GET /api/admin/vendor_audit',
      label: 'GET /',
    },
    {
      routeNeedle: 'adminVendorAuditRouter.get("/csv"',
      registry: 'GET /api/admin/vendor_audit/csv',
      label: 'GET /csv',
    },
  ] as const;

  for (const endpoint of expectedRouteSurface) {
    mustContain(
      routeSrc,
      endpoint.routeNeedle,
      `adminVendorAudit route should expose ${endpoint.label}`,
    );
  }

  mustContain(
    routeSrc,
    'ORDER BY l.ts DESC',
    'adminVendorAudit route should keep newest-first ordering explicit',
  );
  mustContain(
    routeSrc,
    'const maxRows = clampInt(Number(req.query.maxRows ?? 2_000_000), 1, 5_000_000);',
    'adminVendorAudit CSV export should keep the bounded maxRows safety rail explicit',
  );
  mustContain(
    routeSrc,
    'const chunk = clampInt(Number(req.query.chunk ?? 1000), 1, 2000);',
    'adminVendorAudit CSV export should keep the bounded chunk safety rail explicit',
  );
  mustContain(
    routeSrc,
    'LEFT JOIN items it ON it.id = l.item_id',
    'adminVendorAudit route should keep item metadata joins explicit',
  );

  const entry = registry.services?.["web-backend.routes.adminVendorAudit"];
  assert.ok(entry, "WebBackendRegistry.json should contain web-backend.routes.adminVendorAudit");

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
    'Admin read-only viewer endpoint for vendor_log with filters + pagination.',
    'Registry notes should preserve the read-only vendor audit viewer invariant',
  );
  mustContain(
    notes,
    'Joins items table to return item_name + item_rarity in JSON and CSV export.',
    'Registry notes should preserve the joined item metadata export invariant',
  );
});
