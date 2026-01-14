// worldcore/test/contract_noRawHpSubtractionOutsideCombat.test.ts
//
// Contract: Direct HP subtraction is forbidden outside approved modules.
//
// Rationale:
// - DamagePolicy + entrypoint checks (MudSpells/MudCombatActions/NpcCombat) are great,
//   but someone can still bypass them by doing raw mutations like:
//     target.hp -= dmg
//     target.hp = target.hp - dmg
//     target.hp = Math.max(0, target.hp - dmg)
// - This test keeps the “damage goes through combat appliers” agreement intact.
//
// Notes:
// - We scan SOURCE TS under /worldcore (not dist).
// - We exclude /worldcore/test itself (tests frequently set hp directly).
// - We strip block comments and ignore line comments to reduce false positives.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // When executed from dist/worldcore/test/*.js:
  // __dirname = <repo>/dist/worldcore/test
  // so repo root is ../../..
  return path.resolve(__dirname, "../../..");
}

function isTsFile(p: string): boolean {
  return p.endsWith(".ts") && !p.endsWith(".d.ts");
}

function walkDir(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];

  while (stack.length) {
    const cur = stack.pop()!;
    const entries = fs.readdirSync(cur, { withFileTypes: true });

    for (const e of entries) {
      const full = path.join(cur, e.name);

      // Skip common noise
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        if (e.name === "dist") continue;
        if (e.name === ".git") continue;
        stack.push(full);
        continue;
      }

      if (e.isFile()) out.push(full);
    }
  }

  return out;
}

function stripBlockComments(s: string): string {
  // Remove /* ... */ including multiline. Best-effort.
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

function normalizeForScan(src: string): string[] {
  const noBlock = stripBlockComments(src);
  const lines = noBlock.split(/\r?\n/);

  // Remove single-line comments (best-effort).
  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) return "";
    // Remove trailing // comment sections (naive, but good enough for contract scanning).
    const idx = line.indexOf("//");
    if (idx >= 0) return line.slice(0, idx);
    return line;
  });
}

type Hit = {
  rel: string;
  lineNo: number;
  line: string;
  rule: string;
};

function relPath(root: string, full: string): string {
  return path.relative(root, full).replace(/\\/g, "/");
}

// Allowlist: files where direct HP subtraction is intentionally allowed.
// Keep this list small and explicit.
const ALLOWLIST = new Set<string>([
  "worldcore/combat/entityCombat.ts",
  "worldcore/combat/NpcCombat.ts",
  "worldcore/npc/NpcManager.ts",

  // Training dummy is a special toy HP pool, allowed to subtract directly.
  "worldcore/mud/actions/MudCombatActions.ts",
  "worldcore/mud/MudTrainingDummy.ts",
  "worldcore/mud/commands/combat/autoattack/trainingDummyAutoAttack.ts",
]);

// Patterns we consider “raw HP subtraction”.
// We focus on “subtract-looking” writes, not legit assignments like hp = maxHp or hp = 0.
const RULES: { name: string; re: RegExp }[] = [
  { name: "hp-minus-equals", re: /\.hp\s*-\=/ },
  // hp = hp - X  (with optional this./obj.)
  { name: "hp-equals-hp-minus", re: /\.hp\s*=\s*[^;\n]*\.hp\s*-\s*/ },
  // hp = Math.max(0, hp - X)
  { name: "hp-math-max-clamp-subtract", re: /\.hp\s*=\s*Math\.max\(\s*0\s*,[^)]*\.hp\s*-\s*/ },
];

test("[contract] no raw HP subtraction outside approved combat appliers", () => {
  const root = repoRootFromDistTestDir();
  const worldcoreDir = path.join(root, "worldcore");

  const allFiles = walkDir(worldcoreDir)
    .map((f) => relPath(root, f))
    // source TS only
    .filter(isTsFile)
    // exclude tests (they often use hp as a fixture)
    .filter((p) => !p.startsWith("worldcore/test/"));

  const hits: Hit[] = [];

  for (const rel of allFiles) {
    if (ALLOWLIST.has(rel)) continue;

    const full = path.join(root, rel);
    let src: string;
    try {
      src = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }

    const lines = normalizeForScan(src);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(".hp")) continue;

      for (const rule of RULES) {
        if (rule.re.test(line)) {
          hits.push({
            rel,
            lineNo: i + 1,
            line: line.trim(),
            rule: rule.name,
          });
        }
      }
    }
  }

  if (hits.length) {
    const msg =
      "Raw HP subtraction detected outside allowlist.\n\n" +
      hits
        .slice(0, 50)
        .map((h) => `- ${h.rel}:${h.lineNo} [${h.rule}] ${h.line}`)
        .join("\n") +
      (hits.length > 50 ? `\n... and ${hits.length - 50} more` : "") +
      "\n\nFix: route damage through combat appliers (applySimpleDamageToPlayer/applyCombatResultToPlayer or NPC manager helpers),\n" +
      "or (rarely) extend the allowlist with a very explicit reason.";

    assert.fail(msg);
  }

  assert.ok(true);
});
