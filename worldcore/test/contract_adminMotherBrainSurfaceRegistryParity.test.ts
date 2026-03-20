// worldcore/test/contract_adminMotherBrainSurfaceRegistryParity.test.ts
// Contract guard: admin Mother Brain route surface stays aligned with registry truth.
//
// Structural/regex-based: avoids spinning up Express or touching the DB.
// Asserts:
// - web-backend/routes/adminMotherBrain.ts exposes the expected route surface
// - WebBackendRegistry.json documents the same live endpoint surface
// - city_signals remains part of the admin Mother Brain read surface

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const fromHere = path.resolve(__dirname, "../../..");
  const sourcePath = path.join(fromHere, "web-backend", "routes", "adminMotherBrain.ts");
  if (fs.existsSync(sourcePath)) return fromHere;

  const fallback = path.resolve(__dirname, "../..");
  const fallbackPath = path.join(fallback, "web-backend", "routes", "adminMotherBrain.ts");
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

test("[contract] admin Mother Brain route surface stays registry-aligned", () => {
  const repoRoot = resolveRepoRoot();
  const routePath = path.join(repoRoot, "web-backend", "routes", "adminMotherBrain.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const routeSrc = readTextOrFail(routePath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    services?: Record<string, { provides?: string[]; notes?: string[] }>;
  };

  const expectedRouteSurface = [
    { method: "get", subpath: "/status", registry: "GET /api/admin/mother_brain/status" },
    { method: "get", subpath: "/wave_budget", registry: "GET /api/admin/mother_brain/wave_budget" },
    { method: "post", subpath: "/wave_budget", registry: "POST /api/admin/mother_brain/wave_budget" },
    { method: "delete", subpath: "/wave_budget/:shardId/:type", registry: "DELETE /api/admin/mother_brain/wave_budget/:shardId/:type" },
    { method: "get", subpath: "/city_signals", registry: "GET /api/admin/mother_brain/city_signals" },
    { method: "get", subpath: "/goals/report_tail", registry: "GET /api/admin/mother_brain/goals/report_tail" },
    { method: "get", subpath: "/goals_proxy_info", registry: "GET /api/admin/mother_brain/goals_proxy_info" },
    { method: "get", subpath: "/goals", registry: "GET /api/admin/mother_brain/goals" },
    { method: "post", subpath: "/goals/run", registry: "POST /api/admin/mother_brain/goals/run" },
    { method: "post", subpath: "/goals/clear", registry: "POST /api/admin/mother_brain/goals/clear" },
    { method: "post", subpath: "/goals/set", registry: "POST /api/admin/mother_brain/goals/set" },
  ] as const;

  for (const endpoint of expectedRouteSurface) {
    mustContain(
      routeSrc,
      `router.${endpoint.method}("${endpoint.subpath}"`,
      `adminMotherBrain route should expose ${endpoint.registry}`,
    );
  }

  mustContain(
    routeSrc,
    'summarizePlayerWorldConsequences',
    'adminMotherBrain route should keep city_signals world consequence summary wiring explicit',
  );
  mustContain(
    routeSrc,
    'deriveEconomyCartelResponseState',
    'adminMotherBrain route should keep city_signals cartel response state wiring explicit',
  );

  const entry = registry.services?.["web-backend.routes.adminMotherBrain"];
  assert.ok(entry, "WebBackendRegistry.json should contain web-backend.routes.adminMotherBrain");

  const provides = entry.provides ?? [];
  for (const endpoint of expectedRouteSurface) {
    mustContain(
      provides.join(""),
      endpoint.registry,
      `WebBackendRegistry.json should document ${endpoint.registry}`,
    );
  }

  const notes = (entry.notes ?? []).join("");
  mustContain(notes, 'Mounted at /api/admin/mother_brain', 'Registry notes should preserve the mounted base path');
  mustContain(notes, 'city consequence signal inspection', 'Registry notes should mention the city_signals inspection surface');
});
