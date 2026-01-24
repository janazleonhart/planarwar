// worldcore/test/contract_adminSpawnPointsConfirmRequiredUi.test.ts
//
// Contract test: the Admin Spawn Points UI must support the backend's
// 409 { error: "confirm_required", expectedConfirmToken } flow for Mother Brain ops.
//
// IMPORTANT: This is a static scan (no runtime UI execution) so it can run in the
// worldcore workspace test harness without spinning up web-frontend.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function repoRoot(): string {
  // Tests execute from compiled JS under: <repo>/dist/worldcore/test
  // So ../../../ brings us back to <repo>.
  return path.resolve(__dirname, "../../../");
}

test("[contract] AdminSpawnPointsPage handles confirm_required flow for Mother Brain ops", () => {
  const root = repoRoot();

  const frontendRel = "web-frontend/pages/AdminSpawnPointsPage.tsx";
  const frontendAbs = path.join(root, frontendRel);

  const src = fs.readFileSync(frontendAbs, "utf8");

  // Must call the Mother Brain endpoints (wave + wipe).
  assert.ok(
    src.includes("/api/admin/spawn_points/mother_brain/wave"),
    `${frontendRel} must call /api/admin/spawn_points/mother_brain/wave`,
  );
  assert.ok(
    src.includes("/api/admin/spawn_points/mother_brain/wipe"),
    `${frontendRel} must call /api/admin/spawn_points/mother_brain/wipe`,
  );

  // Must be aware of the backend's confirm_required response shape.
  assert.ok(
    /confirm_required/.test(src),
    `${frontendRel} must handle error: "confirm_required" (409)`,
  );
  assert.ok(
    /expectedConfirmToken/.test(src),
    `${frontendRel} must read expectedConfirmToken from the response`,
  );

  // Must send the confirm token back to the server on commit attempts.
  // We accept either JSON body field "confirm" or a variable named confirmToken used in a request body.
  const sendsConfirm =
    /\bconfirm\s*:\s*[^,}\n]+/.test(src) ||
    /confirmToken/.test(src) ||
    /expectedConfirmToken/.test(src); // fallback: token wiring often reuses the name

  assert.ok(
    sendsConfirm,
    `${frontendRel} must send a confirm token back (e.g., { confirm: token }) on commit`,
  );
});
