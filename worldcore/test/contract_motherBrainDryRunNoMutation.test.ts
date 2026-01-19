import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] Mother Brain dry-run does not mutate (uses ROLLBACK)", () => {
  // __dirname = <repo>/dist/worldcore/test
  const root = path.resolve(__dirname, "../../..");
  const backendRel = "web-backend/routes/adminSpawnPoints.ts";
  const backendPath = path.join(root, backendRel);
  assert.ok(fs.existsSync(backendPath), `Expected ${backendRel} to exist`);

  const src = fs.readFileSync(backendPath, "utf8");

  function scanRoute(route: string): string {
    const idx = src.indexOf(route);
    assert.ok(idx >= 0, `${backendRel} must define ${route}`);
    return src.slice(idx, idx + 20000);
  }

  const wave = scanRoute("/mother_brain/wave");
  const wipe = scanRoute("/mother_brain/wipe");

  // We don’t parse the whole AST here. We just enforce that each handler has
  // transaction safety primitives.
  const mustHaveTxn = (chunk: string, name: string) => {
    assert.ok(/\bBEGIN\b/i.test(chunk), `${name} must BEGIN a transaction`);
    assert.ok(/\bROLLBACK\b/i.test(chunk), `${name} must ROLLBACK for dry-run`);
  };

  mustHaveTxn(wave, "mother_brain/wave");
  mustHaveTxn(wipe, "mother_brain/wipe");
});
