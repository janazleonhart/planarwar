// worldcore/test/contract_mudPlayerDamageUsesDamagePolicy.test.ts
//
// Contract: MUD player-vs-player damage entrypoints must consult DamagePolicy.canDamage.
// Prevents bypassing region combat flags / PvP rules / service protection.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("[contract] MUD PvP damage consults DamagePolicy.canDamage", () => {
  const root = repoRootFromDistTestDir();

  const files = [
    "worldcore/mud/MudSpells.ts",
    "worldcore/mud/actions/MudCombatActions.ts",
  ];

  const blobs = files.map((f) => read(root, f));

  assert.ok(
    blobs.some((b) => b.includes("canDamage(")),
    "Expected at least one canDamage(...) call in MUD PvP damage entrypoints.",
  );
});
