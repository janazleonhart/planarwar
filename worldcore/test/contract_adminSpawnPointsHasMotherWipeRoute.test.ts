// worldcore/test/contract_adminSpawnPointsHasMotherWipeRoute.test.ts
// Contract guard: admin spawn points router exposes Mother Brain wipe endpoint.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

test("[contract] admin spawn points exposes /mother_brain/wipe", () => {
  const repoRoot = repoRootFromDistTestDir();
  const routePath = path.join(repoRoot, "web-backend", "routes", "adminSpawnPoints.ts");
  const src = readTextOrFail(routePath);

  assert.ok(
    src.includes('router.post("/mother_brain/wipe"') || src.includes("router.post('/mother_brain/wipe'"),
    "Expected router.post('/mother_brain/wipe') endpoint",
  );

  // Ensure it stays transaction-safe.
  assert.ok(src.includes('await client.query("BEGIN")'), "Expected BEGIN transaction");
  assert.ok(
    src.includes('await client.query("ROLLBACK")') || src.includes("await client.query('ROLLBACK')"),
    "Expected rollback when commit=false",
  );
});
