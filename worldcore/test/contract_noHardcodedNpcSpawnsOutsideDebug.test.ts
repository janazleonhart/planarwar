import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  return path.resolve(__dirname, "../../..");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  return out;
}

function normalizeLines(src: string): string[] {
  // Strip trailing comments for cheaper pattern matching.
  return src.split(/\r?\n/).map((line) => {
    const idx = line.indexOf("//");
    if (idx >= 0) return line.slice(0, idx);
    return line;
  });
}

type Hit = { file: string; lineNo: number; line: string; reason: string };

// Debug and tools are allowed to spawn NPCs anywhere.
// Tests are also allowed to contain literal coords.
const ALLOW_PATH_PREFIXES = [
  "worldcore/mud/commands/debug/",
  "worldcore/tools/",
  "worldcore/test/",
];

// We only want to catch truly suspicious “spawn NPC by literal coords” patterns.
// Importantly: we should NOT flag:
// - default x:0/z:0 in entity templates
// - walkto target structs (not spawning anything)
// - coordinate parsing/teleport/position math for players
//
// So we ONLY scan spawn-ish function calls.
const SPAWN_CALL_START_RE = /\b(?:spawnNpcById|spawnNpc|spawnNPC)\s*\(/;

function countNumericLiterals(s: string): number {
  // Counts literal numeric tokens like -12, 3.14, 0, 99
  const m = s.match(/(^|[^A-Za-z0-9_])(-?\d+(?:\.\d+)?)(?![A-Za-z0-9_])/g);
  return m ? m.length : 0;
}

function gatherCallChunk(lines: string[], startIdx: number, maxLines = 12): { chunk: string; endIdx: number } {
  // Join a small window to support multiline spawn calls:
  //   spawnNpcById(
  //     "rat",
  //     room,
  //     10, 0, 10
  //   );
  let chunk = lines[startIdx] ?? "";
  let endIdx = startIdx;

  for (let j = startIdx + 1; j < lines.length && j <= startIdx + maxLines; j++) {
    endIdx = j;
    chunk += " " + (lines[j] ?? "");
    // Stop once we plausibly closed the call.
    if (/\)\s*;?/.test(chunk)) break;
  }

  // Collapse whitespace for cleaner error printing.
  chunk = chunk.replace(/\s+/g, " ").trim();
  return { chunk, endIdx };
}

function isForbiddenLiteralCoordSpawn(callChunk: string): boolean {
  // We consider it forbidden if:
  // - It is a spawnNpc/spawnNpcById/spawnNPC call
  // - AND it contains 3+ numeric literals in the call args (x,y,z strongly implied)
  //
  // This avoids false positives from single numeric params (hp, id, count, etc.).
  if (!SPAWN_CALL_START_RE.test(callChunk)) return false;

  const numCount = countNumericLiterals(callChunk);
  return numCount >= 3;
}

test("[contract] NPC spawns must be spawn_points-driven outside debug/tools", () => {
  const root = repoRootFromDistTestDir();
  const worldcoreRoot = path.join(root, "worldcore");

  const all = walk(worldcoreRoot)
    .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))
    .map((abs) => path.relative(root, abs).replace(/\\/g, "/"));

  const hits: Hit[] = [];

  for (const file of all) {
    if (ALLOW_PATH_PREFIXES.some((p) => file.startsWith(p))) continue;

    const full = path.join(root, file);
    let src = "";
    try {
      src = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }

    // Cheap prefilter: only consider files that mention spawnNpc* at all.
    const lower = src.toLowerCase();
    if (!lower.includes("spawnnpc")) continue;

    const lines = normalizeLines(src);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      if (!SPAWN_CALL_START_RE.test(line)) continue;

      const { chunk } = gatherCallChunk(lines, i);

      if (isForbiddenLiteralCoordSpawn(chunk)) {
        hits.push({
          file,
          lineNo: i + 1,
          line: chunk,
          reason: "spawnNpc* called with 3+ numeric literals (likely x,y,z)",
        });
      }
    }
  }

  if (hits.length) {
    const msg =
      "Hardcoded NPC spawn-by-coordinates detected outside debug/tools/tests.\n\n" +
      hits
        .slice(0, 50)
        .map((h) => `- ${h.file}:${h.lineNo} [${h.reason}] ${h.line}`)
        .join("\n") +
      (hits.length > 50 ? `\n... and ${hits.length - 50} more` : "") +
      "\n\nFix:\n" +
      "- Use spawn_points + SpawnPointService for real NPC placement.\n" +
      "- Keep arbitrary coordinate spawns inside debug commands/tools only.\n" +
      "- If this flags something legit, refine detection narrowly (don’t broaden allowlists).";

    assert.fail(msg);
  }

  assert.ok(true);
});
