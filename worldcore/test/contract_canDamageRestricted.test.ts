// worldcore/test/contract_canDamageRestricted.test.ts
//
// Lane G (contract):
// Restrict async DamagePolicy.canDamage(...) usage to combat entrypoints only.
//
// Why:
// - canDamage(...) is async and may consult RegionFlags provider.
// - We do NOT want this creeping into random systems (regen loops, loot, ticks).
// - Entrypoints should call canDamage(...); low-level appliers use canDamageFast(...).
//
// This scans SOURCE TS under /worldcore (not dist) and excludes /worldcore/test.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
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
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

function normalizeForScan(src: string): string[] {
  const noBlock = stripBlockComments(src);
  const lines = noBlock.split(/\r?\n/);

  return lines.map((line) => {
    const t = line.trim();
    if (t.startsWith("//")) return "";
    const idx = line.indexOf("//");
    if (idx >= 0) return line.slice(0, idx);
    return line;
  });
}

function relPath(root: string, full: string): string {
  return path.relative(root, full).replace(/\\/g, "/");
}

type Hit = { rel: string; lineNo: number; line: string };

const ALLOWLIST = new Set<string>([
  // Combat entrypoints that are allowed to consult async policy:
  "worldcore/mud/MudSpells.ts",
  "worldcore/mud/actions/MudCombatActions.ts",
  "worldcore/combat/NpcCombat.ts",

  // If you add new combat entrypoints later (e.g. PvpService, CrimeService),
  // add them explicitly here.
]);

function isCanDamageDeclaration(line: string): boolean {
  // Match:
  //   export async function canDamage(
  //   async function canDamage(
  return /\b(?:export\s+)?(?:async\s+)?function\s+canDamage\s*\(/.test(line);
}

function isCanDamageCall(line: string): boolean {
  // Call site looks like canDamage( ... ), but we must avoid:
  // - canDamageFast(
  // - the function declaration
  if (line.includes("canDamageFast(")) return false;
  if (!/\bcanDamage\s*\(/.test(line)) return false;
  if (isCanDamageDeclaration(line)) return false;
  return true;
}

test("[contract] async canDamage is restricted to combat entrypoints", () => {
  const root = repoRootFromDistTestDir();
  const worldcoreDir = path.join(root, "worldcore");

  const files = walkDir(worldcoreDir)
    .map((f) => relPath(root, f))
    .filter(isTsFile)
    .filter((p) => !p.startsWith("worldcore/test/"));

  const hits: Hit[] = [];

  for (const rel of files) {
    const full = path.join(root, rel);
    let src: string;
    try {
      src = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }

    if (!src.includes("canDamage")) continue;

    const lines = normalizeForScan(src);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("canDamage")) continue;

      if (isCanDamageCall(line)) {
        if (!ALLOWLIST.has(rel)) {
          hits.push({ rel, lineNo: i + 1, line: line.trim() });
        }
      }
    }
  }

  if (hits.length) {
    const msg =
      "canDamage(...) call detected outside allowlist.\n\n" +
      hits
        .slice(0, 50)
        .map((h) => `- ${h.rel}:${h.lineNo} ${h.line}`)
        .join("\n") +
      (hits.length > 50 ? `\n... and ${hits.length - 50} more` : "") +
      "\n\nFix:\n" +
      "- Move policy checks to entrypoints (MudSpells/MudCombatActions/NpcCombat)\n" +
      "- Low-level appliers use canDamageFast(...) only\n" +
      "- If a new combat entrypoint is introduced, add it to the allowlist explicitly.";

    assert.fail(msg);
  }

  assert.ok(true);
});
