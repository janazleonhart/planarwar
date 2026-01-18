// worldcore/test/contract_motherBrainToolHasStatusCommand.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] motherBrain tool supports status command", () => {
  // Tests run against compiled JS in dist/worldcore/test.
  // __dirname will be: <repo>/dist/worldcore/test
  // Tool should be:   <repo>/dist/worldcore/tools/motherBrain.js
  const toolJs = path.resolve(__dirname, "..", "tools", "motherBrain.js");

  assert.ok(
    fs.existsSync(toolJs),
    `Expected compiled tool at ${toolJs} (run: npm run build --workspace worldcore)`
  );

  const src = fs.readFileSync(toolJs, "utf8");

  // 1) Must include literal status token somewhere (help text or dispatch table).
  assert.ok(
    /["']status["']/.test(src) || /\bstatus\b/.test(src),
    "motherBrain tool must include the 'status' command token"
  );

  // 2) Must include some plausible dispatch construct that refers to status.
  // We accept multiple styles:
  // - if/else dispatch:        === "status"
  // - switch dispatch:         case "status"
  // - command handler map:     { status: ... } or "status": ...
  // - handler registration:    COMMANDS.status = ... or handlers.status = ...
  const hasBranch =
    /===\s*["']status["']/.test(src) ||
    /case\s+["']status["']/.test(src) ||
    /["']status["']\s*:/.test(src) ||
    /\bstatus\s*:/.test(src) ||
    /\.(?:status)\s*=/.test(src) ||
    /\[(["'])status\1\]\s*=/.test(src);

  assert.ok(
    hasBranch,
    "motherBrain tool must include a status dispatch (if/switch/handler-map assignment)"
  );
});
