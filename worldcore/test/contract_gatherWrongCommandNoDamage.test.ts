import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function findRepoRoot(): string {
  const candidates = [
    path.resolve(__dirname, "../../.."),
    path.resolve(__dirname, "../../../.."),
  ];

  for (const root of candidates) {
    const p = path.join(root, "worldcore", "mud", "actions", "MudWorldActions.ts");
    if (fs.existsSync(p)) return root;
  }

  return candidates[0];
}

function readAt(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("[contract] wrong gathering command must return before node is damaged", () => {
  const root = findRepoRoot();
  const src = readAt(root, "worldcore/mud/actions/MudWorldActions.ts");

  const gate = src.indexOf("if (!allowed.includes(nodeTag))");
  assert.ok(gate >= 0, "MudWorldActions must gate wrong command via allowed.includes(nodeTag)");

  const gateReturn = src.indexOf("return `That isn't compatible", gate);
  assert.ok(gateReturn >= 0, "Wrong-command gate must return a helpful message");

  const damage = src.indexOf("applyDamage(", gate);
  assert.ok(damage >= 0, "MudWorldActions must apply damage via npcs.applyDamage(...)");

  assert.ok(
    damage > gateReturn,
    "npcs.applyDamage(...) must occur after wrong-command return gate"
  );
});
