// worldcore/test/contract_adminSpawnPointsSurfaceRegistryParity.test.ts
// Contract guard: admin spawn-points route surface stays aligned with registry truth.
// Structural/regex-based: avoids spinning up Express or touching the DB.
// Focused on the live mounted admin family and the previously under-declared
// proto-options / ownership / restore seams.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const fromHere = path.resolve(__dirname, "../../..");
  const sourcePath = path.join(fromHere, "web-backend", "routes", "adminSpawnPoints.ts");
  if (fs.existsSync(sourcePath)) return fromHere;

  const fallback = path.resolve(__dirname, "../..");
  const fallbackPath = path.join(fallback, "web-backend", "routes", "adminSpawnPoints.ts");
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

test("[contract] admin spawn points route surface stays registry-aligned", () => {
  const repoRoot = resolveRepoRoot();
  const routePath = path.join(repoRoot, "web-backend", "routes", "adminSpawnPoints.ts");
  const registryPath = path.join(repoRoot, "web-backend", "WebBackendRegistry.json");

  const routeSrc = readTextOrFail(routePath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    services?: Record<string, { provides?: string[]; notes?: string[] }>;
  };

  const expectedRouteSurface = [
    { method: "get", subpath: "/proto_options", registry: "GET /api/admin/spawn_points/proto_options" },
    { method: "get", subpath: "/", registry: "GET /api/admin/spawn_points" },
    { method: "post", subpath: "/", registry: "POST /api/admin/spawn_points (upsert)" },
    { method: "post", subpath: "/:id/adopt", registry: "POST /api/admin/spawn_points/:id/adopt" },
    { method: "post", subpath: "/:id/release", registry: "POST /api/admin/spawn_points/:id/release" },
    { method: "post", subpath: "/:id/lock", registry: "POST /api/admin/spawn_points/:id/lock" },
    { method: "post", subpath: "/:id/unlock", registry: "POST /api/admin/spawn_points/:id/unlock" },
    { method: "post", subpath: "/bulk_ownership_query", registry: "POST /api/admin/spawn_points/bulk_ownership_query" },
    { method: "delete", subpath: "/:id", registry: "DELETE /api/admin/spawn_points/:id" },
    { method: "post", subpath: "/bulk_delete", registry: "POST /api/admin/spawn_points/bulk_delete" },
    { method: "post", subpath: "/bulk_move", registry: "POST /api/admin/spawn_points/bulk_move" },
    { method: "post", subpath: "/clone", registry: "POST /api/admin/spawn_points/clone" },
    { method: "post", subpath: "/scatter", registry: "POST /api/admin/spawn_points/scatter" },
    { method: "post", subpath: "/restore", registry: "POST /api/admin/spawn_points/restore" },
    { method: "get", subpath: "/mother_brain/status", registry: "GET /api/admin/spawn_points/mother_brain/status" },
    { method: "post", subpath: "/mother_brain/wave", registry: "POST /api/admin/spawn_points/mother_brain/wave" },
    { method: "post", subpath: "/mother_brain/wipe", registry: "POST /api/admin/spawn_points/mother_brain/wipe" },
    { method: "post", subpath: "/town_baseline/plan", registry: "POST /api/admin/spawn_points/town_baseline/plan" },
    { method: "post", subpath: "/town_baseline/apply", registry: "POST /api/admin/spawn_points/town_baseline/apply" },
    { method: "post", subpath: "/snapshot", registry: "POST /api/admin/spawn_points/snapshot" },
    { method: "post", subpath: "/snapshot_query", registry: "POST /api/admin/spawn_points/snapshot_query" },
    { method: "get", subpath: "/snapshots", registry: "GET /api/admin/spawn_points/snapshots" },
    { method: "get", subpath: "/snapshots/:id", registry: "GET /api/admin/spawn_points/snapshots/:id" },
    { method: "post", subpath: "/snapshots/save", registry: "POST /api/admin/spawn_points/snapshots/save" },
    { method: "post", subpath: "/snapshots/save_query", registry: "POST /api/admin/spawn_points/snapshots/save_query" },
    { method: "put", subpath: "/snapshots/:id", registry: "PUT /api/admin/spawn_points/snapshots/:id" },
    { method: "post", subpath: "/snapshots/:id/duplicate", registry: "POST /api/admin/spawn_points/snapshots/:id/duplicate" },
    { method: "delete", subpath: "/snapshots/:id", registry: "DELETE /api/admin/spawn_points/snapshots/:id (confirm-token gated)" },
    { method: "post", subpath: "/snapshots/bulk_delete", registry: "POST /api/admin/spawn_points/snapshots/bulk_delete (preview+commit confirm-token)" },
    { method: "post", subpath: "/snapshots/purge", registry: "POST /api/admin/spawn_points/snapshots/purge (preview+commit confirm-token)" },
    { method: "get", subpath: "/snapshots/retention_status", registry: "GET /api/admin/spawn_points/snapshots/retention_status" },
  ] as const;

  for (const entry of expectedRouteSurface) {
    mustContain(
      routeSrc,
      `.${entry.method}("${entry.subpath}"`,
      `adminSpawnPoints route should expose ${entry.method.toUpperCase()} ${entry.subpath}`,
    );
  }

  const service = registry.services?.["web-backend.routes.adminSpawnPoints"];
  assert.ok(service, "Registry missing web-backend.routes.adminSpawnPoints entry");

  const provides = service?.provides ?? [];
  for (const entry of expectedRouteSurface) {
    mustContain(
      provides.join(""),
      entry.registry,
      `Registry should document ${entry.registry}`,
    );
  }

  const notes = (service?.notes ?? []).join("");
  mustContain(
    notes,
    "ownership actions",
    "adminSpawnPoints registry notes should mention ownership actions",
  );
  mustContain(
    notes,
    "restore",
    "adminSpawnPoints registry notes should mention restore support",
  );
  mustContain(
    notes,
    "snapshot lifecycle",
    "adminSpawnPoints registry notes should mention snapshot lifecycle endpoints",
  );
});
