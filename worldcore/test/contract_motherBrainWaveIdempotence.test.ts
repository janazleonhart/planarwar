import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] Mother Brain wave insert is idempotent (no duplicate spawn_id)", () => {
  // __dirname = <repo>/dist/worldcore/test
  const root = path.resolve(__dirname, "../../..");
  const backendRel = "web-backend/routes/adminSpawnPoints.ts";
  const backendPath = path.join(root, backendRel);
  assert.ok(fs.existsSync(backendPath), `Expected ${backendRel} to exist`);

  const src = fs.readFileSync(backendPath, "utf8");
  const idx = src.indexOf("/mother_brain/wave");
  assert.ok(idx >= 0, `${backendRel} must define /mother_brain/wave`);

  // Narrow scan window near the handler.
  const window = src.slice(idx, idx + 20000);

  const hasOnConflictDoNothing = /ON\s+CONFLICT[\s\S]{0,400}DO\s+NOTHING/i.test(window);

  // Alternate acceptable strategy: query existing spawn_id and filter before inserting.
  const hasSelectSpawnId = /SELECT[\s\S]{0,400}spawn_id/i.test(window);
  const hasSetOrMap = /new\s+(Set|Map)\s*\(/i.test(window) || /existing/i.test(window);
  const hasFilterOrSkip = /filter\s*\(/i.test(window) || /skip/i.test(window);
  const hasPreFilterExisting = hasSelectSpawnId && hasSetOrMap && hasFilterOrSkip;

  assert.ok(
    hasOnConflictDoNothing || hasPreFilterExisting,
    `${backendRel} must guard against duplicate spawn_id inserts (ON CONFLICT DO NOTHING or pre-filter existing)`
  );
});
