// worldcore/test/contract_adminSpawnPointsSnapshotRestoreRoutes.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] AdminSpawnPointsPage exposes snapshot/restore spawn slice ops", () => {
  // Tests run with cwd=/repo/worldcore (workspace), so hop up one level.
  const repoRoot = path.join(process.cwd(), "..");
  const backendRel = "web-backend/routes/adminSpawnPoints.ts";
  const frontendRel = "web-frontend/pages/AdminSpawnPointsPage.tsx";

  const backendPath = path.join(repoRoot, backendRel);
  const frontendPath = path.join(repoRoot, frontendRel);

  const backend = fs.readFileSync(backendPath, "utf8");
  const frontend = fs.readFileSync(frontendPath, "utf8");

  assert.ok(
    backend.includes('router.post("/snapshot"') || backend.includes("router.post('/snapshot'"),
    `${backendRel} must define router.post('/snapshot')`,
  );
  assert.ok(
    backend.includes('router.post("/restore"') || backend.includes("router.post('/restore'"),
    `${backendRel} must define router.post('/restore')`,
  );

  assert.ok(
    frontend.includes("/api/admin/spawn_points/snapshot"),
    `${frontendRel} must call /api/admin/spawn_points/snapshot`,
  );
  assert.ok(
    frontend.includes("/api/admin/spawn_points/restore"),
    `${frontendRel} must call /api/admin/spawn_points/restore`,
  );
});
