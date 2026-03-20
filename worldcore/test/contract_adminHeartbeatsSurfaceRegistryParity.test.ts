// worldcore/test/contract_adminHeartbeatsSurfaceRegistryParity.test.ts
// Contract guard: admin heartbeats route surface stays aligned with registry truth.
//
// Structural/regex-based: avoids spinning up Express or touching the DB.
// Asserts:
// - web-backend/routes/adminHeartbeats.ts exposes the expected read + restart endpoints
// - WebBackendRegistry.json documents the same live endpoint surface
// - restart gating stays explicit and web-backend self-restart denial remains visible

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const fromHere = path.resolve(__dirname, "../../..");
  const sourcePath = path.join(fromHere, "web-backend", "routes", "adminHeartbeats.ts");
  if (fs.existsSync(sourcePath)) return fromHere;

  const fallback = path.resolve(__dirname, "../..");
  const fallbackPath = path.join(fallback, "web-backend", "routes", "adminHeartbeats.ts");
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

test("[contract] admin heartbeats route surface stays registry-aligned", () => {
  const repoRoot = resolveRepoRoot();
  const routePath = path.join(repoRoot, "web-backend", "routes", "adminHeartbeats.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const routeSrc = readTextOrFail(routePath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    services?: Record<string, { provides?: string[]; notes?: string[] }>;
  };

  const expectedRouteSurface = [
    { method: "get", subpath: "/", registry: "GET /api/admin/heartbeats" },
    { method: "post", subpath: "/restart", registry: "POST /api/admin/heartbeats/restart" },
    { method: "post", subpath: "/restart_many", registry: "POST /api/admin/heartbeats/restart_many" },
  ] as const;

  for (const endpoint of expectedRouteSurface) {
    mustContain(
      routeSrc,
      `router.${endpoint.method}("${endpoint.subpath}"`,
      `adminHeartbeats route should expose ${endpoint.registry}`,
    );
  }

  mustContain(
    routeSrc,
    'PW_ADMIN_ALLOW_RESTART',
    'adminHeartbeats route should keep the explicit env gate for restart controls',
  );
  mustContain(
    routeSrc,
    'serviceName === "web-backend"',
    'adminHeartbeats route should keep the explicit web-backend self-restart denial',
  );

  const entry = registry.services?.["web-backend.routes.admin-heartbeats"];
  assert.ok(entry, "WebBackendRegistry.json should contain web-backend.routes.admin-heartbeats");

  const provides = entry.provides ?? [];
  for (const endpoint of expectedRouteSurface) {
    mustContain(
      provides.join(""),
      endpoint.registry,
      `WebBackendRegistry.json should document ${endpoint.registry}`,
    );
  }

  const notes = (entry.notes ?? []).join("");
  mustContain(notes, 'Mounted at /api/admin/heartbeats', 'Registry notes should preserve the mounted base path');
  mustContain(notes, 'PW_ADMIN_ALLOW_RESTART=true', 'Registry notes should preserve the dev-only restart gate');
  mustContain(notes, 'deny web-backend self-restart', 'Registry notes should preserve the self-restart denial invariant');
}); 
