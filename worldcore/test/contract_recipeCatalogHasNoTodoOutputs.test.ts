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
    const p = path.join(root, "worldcore", "tradeskills", "RecipeCatalog.ts");
    if (fs.existsSync(p)) return root;
  }
  return candidates[0];
}

test("[contract] RecipeCatalog must not ship TODO outputs (outputs must exist in DB)", () => {
  const root = findRepoRoot();
  const file = path.join(root, "worldcore", "tradeskills", "RecipeCatalog.ts");
  const src = fs.readFileSync(file, "utf8");

  assert.ok(
    !src.includes("TODO: add to DB items"),
    "RecipeCatalog must not include TODO outputs; add items to DB schema instead."
  );

  // Also ban the old known-bad output IDs if they ever return in recipes:
  assert.ok(
    !src.includes("bar_iron_crude') }, // TODO"),
    "RecipeCatalog must not include commented TODO outputs."
  );
});
