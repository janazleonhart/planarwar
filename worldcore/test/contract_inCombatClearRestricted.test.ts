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

const ALLOWLIST = new Set<string>([
  "worldcore/world/RespawnService.ts",
  "worldcore/systems/recovery/recoveryOps.ts",
]);

const RULES: { name: string; re: RegExp }[] = [
  { name: "inCombatUntil-zero", re: /\.inCombatUntil\s*=\s*0\b/ },
  { name: "inCombatUntil-bracket-zero", re: /\[\s*["']inCombatUntil["']\s*\]\s*=\s*0\b/ },
];

test("[contract] inCombatUntil clear is restricted to respawn/recovery lifecycle modules", () => {
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
    if (!src.includes("inCombatUntil")) continue;

    const lines = normalizeForScan(src);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("inCombatUntil")) continue;

      for (const rule of RULES) {
        if (rule.re.test(line)) {
          hits.push({ rel, lineNo: i + 1, line: line.trim(), rule: rule.name });
        }
      }
    }
  }

  if (hits.length) {
    const msg =
      "Forbidden inCombatUntil=0 detected outside allowlist.\n\n" +
      hits
        .slice(0, 50)
        .map((h) => `- ${h.rel}:${h.lineNo} [${h.rule}] ${h.line}`)
        .join("\n") +
      (hits.length > 50 ? `\n... and ${hits.length - 50} more` : "") +
      "\n\nFix:\n" +
      "- Only RespawnService / recoveryOps may clear combat state.\n" +
      "- If you introduce a new lifecycle module, add it explicitly to the allowlist.";

    assert.fail(msg);
  }

  assert.ok(true);
});
