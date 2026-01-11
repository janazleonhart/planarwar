// worldcore/test/contract_noUnsafeApply.test.ts
//
// Safety rail: ban the "unsafe apply" pattern where a CombatEngine roll's `.damage`
// is fed into applySimpleDamageToPlayer(...).
//
// Why: if a caller ever uses `computeDamage(... applyDefenderDamageTakenMods: true)`,
// then piping `roll.damage` into applySimpleDamageToPlayer() will double-dip incoming
// StatusEffects taken-mods.
//
// The safe pipeline is:
//   const roll = computeDamage(...)
//   applyCombatResultToPlayer(targetEntity, roll, defenderChar)
//
// This test scans *source* TS files (not dist) so it catches regressions early.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";

const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "test", // don't police tests; they can demonstrate unsafe patterns on purpose
]);

async function walkTsFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);

      if (ent.isDirectory()) {
        if (EXCLUDE_DIRS.has(ent.name)) continue;
        await walk(full);
        continue;
      }

      if (!ent.isFile()) continue;
      if (!ent.name.endsWith(".ts")) continue;

      out.push(full);
    }
  }

  await walk(rootDir);
  return out;
}

function findCallStarts(src: string, needle: string): number[] {
  const starts: number[] = [];

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = i + 1 < src.length ? src[i + 1] : "";

    // Comments (only when not in strings)
    if (!inSingle && !inDouble && !inTemplate) {
      if (!inBlockComment && !inLineComment && ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (!inBlockComment && !inLineComment && ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (inLineComment && ch === "\n") {
        inLineComment = false;
        continue;
      }
      if (inBlockComment && ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
        continue;
      }
      if (inLineComment || inBlockComment) continue;
    }

    // Strings
    if (!inDouble && !inTemplate && ch === "'" && !inSingle) {
      inSingle = true;
      continue;
    } else if (inSingle && ch === "'" && src[i - 1] !== "\\") {
      inSingle = false;
      continue;
    }

    if (!inSingle && !inTemplate && ch === '"' && !inDouble) {
      inDouble = true;
      continue;
    } else if (inDouble && ch === '"' && src[i - 1] !== "\\") {
      inDouble = false;
      continue;
    }

    if (!inSingle && !inDouble && ch === "`" && src[i - 1] !== "\\") {
      inTemplate = !inTemplate;
      continue;
    }

    if (inSingle || inDouble || inTemplate) continue;

    if (src.startsWith(needle, i)) {
      starts.push(i);
      i += needle.length - 1;
      continue;
    }
  }

  return starts;
}

function findMatchingParen(src: string, openIdx: number): number {
  // Parses from an assumed '(' at openIdx and returns the index of the matching ')'.
  let depth = 0;

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    const next = i + 1 < src.length ? src[i + 1] : "";

    // Comments (only when not in strings)
    if (!inSingle && !inDouble && !inTemplate) {
      if (!inBlockComment && !inLineComment && ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (!inBlockComment && !inLineComment && ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (inLineComment && ch === "\n") {
        inLineComment = false;
        continue;
      }
      if (inBlockComment && ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
        continue;
      }
      if (inLineComment || inBlockComment) continue;
    }

    // Strings
    if (!inDouble && !inTemplate && ch === "'" && !inSingle) {
      inSingle = true;
      continue;
    } else if (inSingle && ch === "'" && src[i - 1] !== "\\") {
      inSingle = false;
      continue;
    }

    if (!inSingle && !inTemplate && ch === '"' && !inDouble) {
      inDouble = true;
      continue;
    } else if (inDouble && ch === '"' && src[i - 1] !== "\\") {
      inDouble = false;
      continue;
    }

    if (!inSingle && !inDouble && ch === "`" && src[i - 1] !== "\\") {
      inTemplate = !inTemplate;
      continue;
    }

    if (inSingle || inDouble || inTemplate) continue;

    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function splitTopLevelArgs(argSrc: string): string[] {
  const args: string[] = [];
  let buf = "";

  let paren = 0;
  let brace = 0;
  let bracket = 0;

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = 0; i < argSrc.length; i++) {
    const ch = argSrc[i];

    // strings
    if (!inDouble && !inTemplate && ch === "'" && !inSingle) {
      inSingle = true;
      buf += ch;
      continue;
    } else if (inSingle && ch === "'" && argSrc[i - 1] !== "\\") {
      inSingle = false;
      buf += ch;
      continue;
    }

    if (!inSingle && !inTemplate && ch === '"' && !inDouble) {
      inDouble = true;
      buf += ch;
      continue;
    } else if (inDouble && ch === '"' && argSrc[i - 1] !== "\\") {
      inDouble = false;
      buf += ch;
      continue;
    }

    if (!inSingle && !inDouble && ch === "`" && argSrc[i - 1] !== "\\") {
      inTemplate = !inTemplate;
      buf += ch;
      continue;
    }

    if (inSingle || inDouble || inTemplate) {
      buf += ch;
      continue;
    }

    if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);

    if (ch === "," && paren === 0 && brace === 0 && bracket === 0) {
      args.push(buf.trim());
      buf = "";
      continue;
    }

    buf += ch;
  }

  if (buf.trim().length > 0) args.push(buf.trim());
  return args;
}

test("[contract] forbid unsafe applySimpleDamageToPlayer(…, roll.damage, …)", async () => {
  // Tests run from /home/rimuru/planarwar/worldcore (workspace) after build.
  const root = process.cwd();
  const files = await walkTsFiles(root);

  const offenders: Array<{ file: string; snippet: string }> = [];

  const needle = "applySimpleDamageToPlayer(";

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");

    // Only police runtime code.
    if (!rel.startsWith("mud/") && !rel.startsWith("combat/") && !rel.startsWith("npc/")) {
      continue;
    }

    const src = await fs.readFile(file, "utf8");

    const starts = findCallStarts(src, needle);
    for (const start of starts) {
      const openIdx = start + needle.length - 1; // index of '('
      const closeIdx = findMatchingParen(src, openIdx);
      if (closeIdx === -1) continue;

      const argSrc = src.slice(openIdx + 1, closeIdx);
      const args = splitTopLevelArgs(argSrc);

      // We only care when the *2nd argument* is a `.damage` expression,
      // meaning the caller is feeding a CombatResult damage into the unsafe apply.
      const second = (args[1] ?? "").trim();
      if (!second.includes(".damage")) continue;

      const snippet = src
        .slice(start, Math.min(src.length, closeIdx + 1))
        .replace(/\s+/g, " ")
        .trim();

      offenders.push({ file: rel, snippet });
    }
  }

  if (offenders.length > 0) {
    const lines = offenders.map((o) => `- ${o.file}: ${o.snippet}`).join("\n");
    assert.fail(
      [
        "Unsafe apply detected: applySimpleDamageToPlayer(..., roll.damage, ...).",
        "Use applyCombatResultToPlayer(target, roll, defenderChar) instead.",
        "",
        lines,
      ].join("\n"),
    );
  }

  assert.ok(true);
});
