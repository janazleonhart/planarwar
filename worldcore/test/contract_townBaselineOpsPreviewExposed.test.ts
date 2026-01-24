// worldcore/test/contract_townBaselineOpsPreviewExposed.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] town_baseline plan/apply responses expose opsPreview for diff UI", () => {
  // Tests run from dist/worldcore/test; resolve repo root from __dirname.
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const backendRel = "web-backend/routes/adminSpawnPoints.ts";
  const backendAbs = path.join(repoRoot, backendRel);

  const src = fs.readFileSync(backendAbs, "utf8");

  assert.ok(src.includes('router.post("/town_baseline/plan"'), "Expected /town_baseline/plan route");
  assert.ok(src.includes('router.post("/town_baseline/apply"'), "Expected /town_baseline/apply route");

  const planIdx = src.indexOf('router.post("/town_baseline/plan"');
  const applyIdx = src.indexOf('router.post("/town_baseline/apply"');

  const planBlock = src.slice(planIdx, Math.min(src.length, planIdx + 5000));
  const applyBlock = src.slice(applyIdx, Math.min(src.length, applyIdx + 8000));

  assert.ok(/opsPreview:\s*buildTownBaselineOpsPreview\(/.test(planBlock), "Expected opsPreview in plan response");
  assert.ok(/opsPreview:\s*buildTownBaselineOpsPreview\(/.test(applyBlock), "Expected opsPreview in apply response");
});
