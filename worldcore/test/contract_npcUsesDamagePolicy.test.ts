// worldcore/test/contract_npcUsesDamagePolicy.test.ts
//
// Contract guard: NPC combat must consult DamagePolicy.canDamage.
// This prevents bypassing region combatEnabled / service protection rules.
//
// Tests run from dist/worldcore/test/*.js, so we must resolve the repo root
// before reading source TS files.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

test("[contract] NPC combat consults DamagePolicy.canDamage", () => {
  const repoRoot = repoRootFromDistTestDir();
  const npcManagerPath = path.join(repoRoot, "worldcore", "npc", "NpcManager.ts");
  const npcCombatPath = path.join(repoRoot, "worldcore", "combat", "NpcCombat.ts");

  const npcManager = readTextOrFail(npcManagerPath);
  const npcCombat = readTextOrFail(npcCombatPath);

  const blob = npcManager + "\n" + npcCombat;

  // Must call canDamage somewhere in NPC combat paths.
  assert.ok(
    blob.includes("canDamage("),
    "Expected at least one canDamage(...) call in NPC combat paths.",
  );

  // Must import DamagePolicy somewhere.
  const hasImport =
    blob.includes('from "../combat/DamagePolicy"') ||
    blob.includes('from "./DamagePolicy"') ||
    blob.includes('from "../combat/DamagePolicy.ts"') ||
    blob.includes('from "./DamagePolicy.ts"');

  assert.ok(hasImport, "Expected NPC combat to import canDamage from DamagePolicy.");
});
