// worldcore/test/contract_simBrainMotherWaveDryRunRollback.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("[contract] simBrain mother-wave uses transaction + rollback for dry-run", () => {
  const toolJs = path.resolve(__dirname, "..", "tools", "simBrain.js");

  assert.ok(
    fs.existsSync(toolJs),
    `Expected compiled tool at ${toolJs} (run: npm run build --workspace worldcore)`
  );

  const src = fs.readFileSync(toolJs, "utf8");

  const m = src.match(/\bcmd\s*===\s*["']mother-wave["']/);
  assert.ok(m && typeof m.index === "number", "simBrain tool must dispatch mother-wave via cmd === 'mother-wave'");

  // Look for BEGIN + ROLLBACK reasonably close to the handler.
  const idx = m.index!;
  const window = src.slice(idx, idx + 60000);
  assert.ok(/\bBEGIN\b/.test(window), "mother-wave should start a transaction (BEGIN)");
  assert.ok(/\bROLLBACK\b/.test(window), "mother-wave should rollback for dry-run");
});
