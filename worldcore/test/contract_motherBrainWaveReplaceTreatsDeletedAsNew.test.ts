import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] Mother Brain replace-mode treats deleted brain spawns as NEW inserts", () => {
  // __dirname = <repo>/dist/worldcore/test
  const root = path.resolve(__dirname, "../../..");
  const backendRel = "web-backend/routes/adminSpawnPoints.ts";
  const backendPath = path.join(root, backendRel);
  assert.ok(fs.existsSync(backendPath), `Expected ${backendRel} to exist`);

  const src = fs.readFileSync(backendPath, "utf8");
  const idx = src.indexOf("/mother_brain/wave");
  assert.ok(idx >= 0, `${backendRel} must define /mother_brain/wave`);

  // Scan a generous window near the handler.
  const window = src.slice(idx, idx + 26000);

  // Accept either strategy:
  // A) derive an 'effectiveExistingSpawnIds' Set and delete existing brain:* ids when append=false
  // B) mutate existingSpawnIds directly (delete brain ids) when append=false
  const hasEffectiveSet =
    /\beffectiveExistingSpawnIds\b/.test(window) &&
    /new\s+Set\s*<[^>]*>\s*\(\s*existingSpawnIds\s*\)/.test(window);

  const hasDeleteInNotAppendEffective =
    /if\s*\(\s*!\s*append\s*\)[\s\S]{0,1200}effectiveExistingSpawnIds\.delete\(/.test(window);

  const hasDeleteInNotAppendDirect =
    /if\s*\(\s*!\s*append\s*\)[\s\S]{0,1200}existingSpawnIds\.delete\(/.test(window);

  assert.ok(
    (hasEffectiveSet && hasDeleteInNotAppendEffective) || hasDeleteInNotAppendDirect,
    `${backendRel} must ensure replace-mode doesn't skip re-inserting spawn_ids that will be deleted (append=false)`
  );
});
