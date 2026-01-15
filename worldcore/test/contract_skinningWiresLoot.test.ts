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
    const p = path.join(root, "worldcore", "mud", "commands", "gathering");
    if (fs.existsSync(p)) return root;
  }

  return candidates[0];
}

function readAt(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function mustMatch(src: string, re: RegExp, msg: string): void {
  assert.ok(re.test(src), msg);
}

function mustNotMatch(src: string, re: RegExp, msg: string): void {
  assert.ok(!re.test(src), msg);
}

test("[contract] skinning command must grant loot and mark corpses as skinned", () => {
  const root = findRepoRoot();
  const src = readAt(root, "worldcore/mud/commands/gathering/skinningCommand.ts");

  mustMatch(src, /applyFallbackSkinLoot\s*\(/, "skinningCommand must use applyFallbackSkinLoot(...) fallback");
  mustMatch(src, /addItemToBags\s*\(/, "skinningCommand must add items to bags");
  mustMatch(src, /getEntitiesInRoom/, "skinningCommand must scan room entities");
  mustMatch(src, /skinned\s*=\s*true/, "skinningCommand must mark corpse as skinned");

  // Ensure it's no longer the old placeholder.
  mustNotMatch(src, /Skinning loot not wired/i, "skinningCommand must not be a stub");
});
