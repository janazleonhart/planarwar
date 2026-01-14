import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
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
        if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
        stack.push(full);
      } else if (e.isFile()) out.push(full);
    }
  }
  return out;
}
function stripBlockComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}
function normalizeForScan(src: string): string[] {
  const noBlock = stripBlockComments(src);
  return noBlock.split(/\r?\n/).map((line) => {
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

type Hit = { rel: string; lineNo: number; line: string; rule: string };

// Allowlist: canonical lifecycle owners only.
// - Player lifecycle: entityCombat / recoveryOps / RespawnService
// - NPC lifecycle: NpcManager (spawn init) / NpcCombat (death handling)
const ALLOWLIST = new Set<string>([
  "worldcore/combat/entityCombat.ts",
  "worldcore/world/RespawnService.ts",
  "worldcore/systems/recovery/recoveryOps.ts",
  "worldcore/npc/NpcManager.ts",
  "worldcore/combat/NpcCombat.ts",
]);

const RULES: { name: string; re: RegExp }[] = [
  { name: "alive-assign", re: /\.alive\s*=\s*(true|false)\b/ },
  { name: "alive-bracket-assign", re: /\[\s*["']alive["']\s*\]\s*=\s*(true|false)\b/ },
];

test("[contract] alive mutations are restricted to canonical lifecycle modules", () => {
  const root = repoRootFromDistTestDir();
  const worldcoreDir = path.join(root, "worldcore");

  const files = walkDir(worldcoreDir)
    .map((f) => relPath(root, f))
    .filter(isTsFile)
    .filter((p) => !p.startsWith("worldcore/test/"));

  const hits: Hit[] = [];

  for (const rel of files) {
    if (ALLOWLIST.has(rel)) continue;

    const full = path.join(root, rel);
    let src = "";
    try {
      src = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (!src.includes("alive")) continue;

    const lines = normalizeForScan(src);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("alive")) continue;

      for (const rule of RULES) {
        if (rule.re.test(line)) {
          hits.push({ rel, lineNo: i + 1, line: line.trim(), rule: rule.name });
        }
      }
    }
  }

  if (hits.length) {
    const msg =
      "Forbidden alive mutation detected outside allowlist.\n\n" +
      hits
        .slice(0, 50)
        .map((h) => `- ${h.rel}:${h.lineNo} [${h.rule}] ${h.line}`)
        .join("\n") +
      (hits.length > 50 ? `\n... and ${hits.length - 50} more` : "") +
      "\n\nFix:\n" +
      "- Route death/resurrection through canonical lifecycle owners.\n" +
      "- If a new lifecycle owner is introduced, add it explicitly to the allowlist (keep it tiny).";

    assert.fail(msg);
  }

  assert.ok(true);
});
