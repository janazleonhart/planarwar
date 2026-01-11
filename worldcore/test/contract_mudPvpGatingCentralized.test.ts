// worldcore/test/contract_mudPvpGatingCentralized.test.ts
//
// Contract guard: all MUD PvP/duel gating must go through MudCombatGates.ts.
// Prevents rule drift across commands (cast/attack/etc).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test("[contract] MUD PvP/duel gating is centralized in MudCombatGates.ts", () => {
  const repoRoot = path.resolve(__dirname, "..", ".."); // dist/worldcore/test -> repo/worldcore
  const mudDir = path.join(repoRoot, "worldcore", "mud");

  // In dist runs, repoRoot resolution can be tricky if layout changes.
  // Fail clearly if we can't find the folder rather than silently passing.
  assert.ok(fs.existsSync(mudDir), `Expected mud dir to exist: ${mudDir}`);

  const files = walk(mudDir).filter((p) => p.endsWith(".ts"));

  const bannedNeedles = [
    "canDamagePlayer(",
    "isPvpEnabledForRegion(",
    "DUEL_SERVICE.isActiveBetween(",
    "DUEL_SERVICE.getActiveDuelFor(",
    "DUEL_SERVICE.tick(",
  ];

  const allowFile = path.join(mudDir, "MudCombatGates.ts");

  const offenders: Array<{ file: string; needle: string }> = [];

  for (const f of files) {
    if (path.resolve(f) === path.resolve(allowFile)) continue;

    const text = fs.readFileSync(f, "utf8");
    for (const needle of bannedNeedles) {
      if (text.includes(needle)) {
        offenders.push({ file: f, needle });
      }
    }
  }

  if (offenders.length) {
    const lines = offenders
      .map((o) => `- ${path.relative(repoRoot, o.file)} contains "${o.needle}"`)
      .join("\n");
    assert.fail(
      `PvP/duel gating must be centralized in worldcore/mud/MudCombatGates.ts.\nOffenders:\n${lines}`,
    );
  }
});
