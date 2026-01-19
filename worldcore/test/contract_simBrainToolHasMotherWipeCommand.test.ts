// worldcore/test/contract_simBrainToolHasMotherWipeCommand.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] simBrain tool supports mother-wipe command", () => {
  // Tests run against compiled JS in dist/worldcore/test.
  // __dirname will be: <repo>/dist/worldcore/test
  // Tool should be:   <repo>/dist/worldcore/tools/simBrain.js
  const toolJs = path.resolve(__dirname, "..", "tools", "simBrain.js");

  assert.ok(
    fs.existsSync(toolJs),
    `Expected compiled tool at ${toolJs} (run: npm run build --workspace worldcore)`
  );

  const src = fs.readFileSync(toolJs, "utf8");

  // 1) Must include literal command token somewhere (help text or dispatch table).
  assert.ok(/\bmother-wipe\b/.test(src), "simBrain tool must include the 'mother-wipe' command token");

  // 2) Must include a plausible dispatch construct that refers to mother-wipe.
  const hasBranch =
    /===\s*["']mother-wipe["']/.test(src) ||
    /case\s+["']mother-wipe["']/.test(src) ||
    /["']mother-wipe["']\s*:/.test(src) ||
    /\bmother-wipe\b\s*:/.test(src) ||
    /\.(?:mother-wipe)\s*=/.test(src) ||
    /\[("|')mother-wipe\1\]\s*=/.test(src);

  assert.ok(hasBranch, "simBrain tool must dispatch mother-wipe (if/switch/handler-map)");
});
