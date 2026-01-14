// worldcore/test/contract_canDamageFastRestricted.test.ts
//
// Contract: canDamageFast(...) must only be *called* in low-level combat appliers.
//
// Rationale:
// - canDamageFast is synchronous and must not consult RegionFlags provider/DB.
// - Entry points should use async canDamage(...) so region combatEnabled / PvP flags
//   can be honored correctly.
// - canDamageFast exists ONLY as a safety backstop in core appliers.
//
// This test scans SOURCE TS under /worldcore (not dist) for canDamageFast call sites.
// It excludes /worldcore/test itself.
//
// Important: we must NOT flag the function declaration in DamagePolicy.ts.

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
  // The intended “fast policy backstop” call site.
  "worldcore/combat/entityCombat.ts",

  // If you later add another low-level applier, add it explicitly here.
]);

function isCanDamageFastDeclaration(line: string): boolean {
  // Match declarations like:
  //   function canDamageFast(
  //   export function canDamageFast(
  //   export async function canDamageFast(  (unlikely, but harmless)
  return /\b(?:export\s+)?(?:async\s+)?function\s+canDamageFast\s*\(/.test(line);
}

function isCanDamageFastCall(line: string): boolean {
  // A call site looks like:
  //   canDamageFast(
  //   DamagePolicy.canDamageFast(
  //   something.canDamageFast(
  //
  // But we avoid matching declarations. Also avoid matching type names / comments
  // via prior normalization.
  if (!/\bcanDamageFast\s*\(/.test(line)) return false;
  if (isCanDamageFastDeclaration(line)) return false;
  return true;
}

test("[contract] canDamageFast is restricted to low-level combat appliers", () => {
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

    if (!src.includes("canDamageFast")) continue;

    const lines = normalizeForScan(src);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("canDamageFast")) continue;

      if (isCanDamageFastCall(line)) {
        if (!ALLOWLIST.has(rel)) {
          hits.push({ rel, lineNo: i + 1, line: line.trim() });
        }
      }
    }
  }

  if (hits.length) {
    const msg =
      "canDamageFast(...) call detected outside allowlist.\n\n" +
      hits
        .slice(0, 50)
        .map((h) => `- ${h.rel}:${h.lineNo} ${h.line}`)
        .join("\n") +
      (hits.length > 50 ? `\n... and ${hits.length - 50} more` : "") +
      "\n\nFix:\n" +
      "- Entry points should use async canDamage(...)\n" +
      "- Only low-level appliers may use canDamageFast as a backstop\n" +
      "- If you truly need a new low-level applier, add it to the allowlist with a clear reason.";

    assert.fail(msg);
  }

  assert.ok(true);
});
