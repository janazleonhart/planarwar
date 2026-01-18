#!/usr/bin/env node
/* worldcore/tools/registryCheck.js
 *
 * Registry guardrail:
 * - Ensures new worldcore TS/TSX files get entries in WorldCoreRegistry.json.
 *
 * Modes:
 *   --mode=worktree   (default) check untracked + staged + unstaged NEW files locally
 *   --mode=ci         check NEW files in PR diff (merge-base vs base)
 *   --mode=all        audit all worldcore TS/TSX files (report missing; optional --strict)
 *
 * Options:
 *   --strict          (mode=all) exit non-zero if missing
 *   --allowlist=<p>   optional allowlist file (default: worldcore/tools/registryCheck.allowlist.txt)
 *
 * Exit codes:
 *   0 ok
 *   2 missing registry entries
 *   3 tool error
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

function die(msg, code = 3) {
  console.error(`[registry-check] ${msg}`);
  process.exit(code);
}

function run(cmd, opts = {}) {
  const r = cp.spawnSync(cmd[0], cmd.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const stderr = (r.stderr || "").trim();
    const stdout = (r.stdout || "").trim();
    throw new Error(
      `Command failed: ${cmd.join(" ")} (exit=${r.status})${stderr ? `\n${stderr}` : ""}${
        stdout ? `\n${stdout}` : ""
      }`,
    );
  }
  return (r.stdout || "").trim();
}

function findRepoRoot(startDir) {
  let cur = startDir;
  while (true) {
    const gitDir = path.join(cur, ".git");
    if (fs.existsSync(gitDir)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function readTextIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function normalizeSlashes(p) {
  return p.replace(/\\/g, "/");
}

function isTsOrTsx(p) {
  return p.endsWith(".ts") || p.endsWith(".tsx");
}

function isDts(p) {
  return p.endsWith(".d.ts");
}

function isUnderWorldcore(rel) {
  const n = normalizeSlashes(rel);
  return n === "worldcore" || n.startsWith("worldcore/");
}

function shouldIgnorePath(rel) {
  const n = normalizeSlashes(rel);

  if (!isUnderWorldcore(n)) return true;
  if (!isTsOrTsx(n)) return true;
  if (isDts(n)) return true;

  // common ignore zones
  if (n.includes("/node_modules/")) return true;
  if (n.includes("/dist/")) return true;
  if (n.includes("/.next/")) return true;

  return false;
}

function loadAllowlist(allowlistPath) {
  const raw = readTextIfExists(allowlistPath);
  if (!raw) return [];

  const lines = raw
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  // allow exact paths or simple glob-ish patterns:
  // - "*" matches any characters except path separator
  // - "**" matches any characters including separators
  return lines.map((pat) => {
    const esc = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const re = esc
      .replace(/\\\*\\\*/g, "<<<TWOSTAR>>>")
      .replace(/\\\*/g, "[^/]*")
      .replace(/<<<TWOSTAR>>>/g, ".*");
    return { pat, rx: new RegExp("^" + re + "$") };
  });
}

function isAllowlisted(rel, allowlist) {
  const n = normalizeSlashes(rel);
  return allowlist.some((a) => a.rx.test(n));
}

function collectRegistryPaths(registryJson) {
  const out = new Set();

  function walk(v) {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") {
      // If an object has a `path` field, treat it as a file path.
      if (typeof v.path === "string") {
        const p = normalizeSlashes(v.path);
        if (p) out.add(p);
      }
      for (const k of Object.keys(v)) walk(v[k]);
    }
  }

  walk(registryJson);
  return out;
}

function readRegistry(repoRoot) {
  const registryPath = path.join(repoRoot, "worldcore", "WorldCoreRegistry.json");
  if (!fs.existsSync(registryPath)) die(`Missing WorldCoreRegistry.json at ${registryPath}`);

  let json;
  try {
    json = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (e) {
    die(`Failed to parse WorldCoreRegistry.json: ${String(e && e.message ? e.message : e)}`);
  }

  return { registryPath, registryPaths: collectRegistryPaths(json) };
}

function walkDirRecursive(absDir) {
  const out = [];
  const stack = [absDir];

  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // skip common big dirs
        const n = ent.name.toLowerCase();
        if (n === "node_modules" || n === "dist" || n === ".git") continue;
        stack.push(p);
      } else if (ent.isFile()) {
        out.push(p);
      }
    }
  }

  return out;
}

function relFromRoot(repoRoot, absPath) {
  return normalizeSlashes(path.relative(repoRoot, absPath));
}

function getCandidatesAll(repoRoot) {
  const absWorldcore = path.join(repoRoot, "worldcore");
  const files = walkDirRecursive(absWorldcore);
  const rels = files.map((p) => relFromRoot(repoRoot, p));
  return rels.filter((r) => !shouldIgnorePath(r));
}

function parseNameStatusLines(text) {
  // Format: "A\tpath" or "R100\told\tnew"
  const out = [];
  const lines = (text || "").split(/\r?\n/g).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (!parts.length) continue;

    const status = parts[0];
    if (status.startsWith("R")) {
      // rename: last token is new path
      const newPath = parts[2] || parts[parts.length - 1];
      if (newPath) out.push({ status: "R", path: normalizeSlashes(newPath) });
      continue;
    }
    const p = parts[1];
    if (p) out.push({ status, path: normalizeSlashes(p) });
  }
  return out;
}

function getCandidatesWorktree(repoRoot) {
  // 1) untracked
  let untracked = [];
  try {
    const out = run(["git", "ls-files", "--others", "--exclude-standard"], { cwd: repoRoot });
    untracked = out ? out.split(/\r?\n/g).map((l) => l.trim()).filter(Boolean) : [];
  } catch {
    // If git isn't available, we can't do worktree diff
    die("git not available; cannot run --mode=worktree");
  }

  // 2) staged name-status
  let staged = [];
  try {
    const out = run(["git", "diff", "--cached", "--name-status"], { cwd: repoRoot });
    staged = parseNameStatusLines(out)
      .filter((x) => x.status === "A" || x.status === "R")
      .map((x) => x.path);
  } catch {
    staged = [];
  }

  // 3) unstaged name-status
  let unstaged = [];
  try {
    const out = run(["git", "diff", "--name-status"], { cwd: repoRoot });
    unstaged = parseNameStatusLines(out)
      .filter((x) => x.status === "A" || x.status === "R")
      .map((x) => x.path);
  } catch {
    unstaged = [];
  }

  const combined = new Set([...untracked, ...staged, ...unstaged].map(normalizeSlashes));
  const candidates = [...combined].filter((r) => !shouldIgnorePath(r));
  return candidates;
}

function guessCiBase(repoRoot) {
  // Prefer GitHub env if present
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) return `origin/${baseRef}`;

  // Fall back to origin/main then origin/master
  try {
    run(["git", "rev-parse", "--verify", "origin/main"], { cwd: repoRoot });
    return "origin/main";
  } catch {}
  try {
    run(["git", "rev-parse", "--verify", "origin/master"], { cwd: repoRoot });
    return "origin/master";
  } catch {}

  return null;
}

function getCandidatesCi(repoRoot) {
  const base = guessCiBase(repoRoot);
  if (!base) {
    // last-resort: compare to previous commit
    const out = run(["git", "diff", "--name-status", "HEAD~1...HEAD"], { cwd: repoRoot });
    return parseNameStatusLines(out)
      .filter((x) => x.status === "A" || x.status === "R")
      .map((x) => x.path)
      .filter((r) => !shouldIgnorePath(r));
  }

  let mergeBase;
  try {
    mergeBase = run(["git", "merge-base", "HEAD", base], { cwd: repoRoot });
  } catch (e) {
    die(`Could not determine merge base vs ${base}: ${String(e && e.message ? e.message : e)}`);
  }

  const out = run(["git", "diff", "--name-status", `${mergeBase}...HEAD`], { cwd: repoRoot });
  return parseNameStatusLines(out)
    .filter((x) => x.status === "A" || x.status === "R")
    .map((x) => x.path)
    .filter((r) => !shouldIgnorePath(r));
}

function parseArgs(argv) {
  const args = {
    mode: "worktree",
    strict: false,
    allowlistPath: null,
  };

  for (const a of argv) {
    if (a.startsWith("--mode=")) args.mode = a.slice("--mode=".length).trim();
    else if (a === "--strict") args.strict = true;
    else if (a.startsWith("--allowlist=")) args.allowlistPath = a.slice("--allowlist=".length).trim();
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) die("Could not find repo root (no .git found upward from cwd). Run inside the repo.");

  const { registryPath, registryPaths } = readRegistry(repoRoot);

  const defaultAllow = path.join(repoRoot, "worldcore", "tools", "registryCheck.allowlist.txt");
  const allowlistPath = args.allowlistPath
    ? path.isAbsolute(args.allowlistPath)
      ? args.allowlistPath
      : path.join(process.cwd(), args.allowlistPath)
    : defaultAllow;

  const allowlist = loadAllowlist(allowlistPath);

  let candidates = [];
  if (args.mode === "worktree") candidates = getCandidatesWorktree(repoRoot);
  else if (args.mode === "ci") candidates = getCandidatesCi(repoRoot);
  else if (args.mode === "all") candidates = getCandidatesAll(repoRoot);
  else die(`Unknown --mode=${args.mode}. Use worktree|ci|all`);

  // Filter allowlist
  candidates = candidates.filter((r) => !isAllowlisted(r, allowlist));

  // Determine missing: candidate file not referenced in registryPaths
  const missing = candidates.filter((r) => !registryPaths.has(normalizeSlashes(r)));

  const header = `[registry-check] mode=${args.mode} registry=${normalizeSlashes(
    path.relative(repoRoot, registryPath),
  )} allowlist=${normalizeSlashes(path.relative(repoRoot, allowlistPath))}`;

  if (!candidates.length) {
    console.log(`${header}\n[registry-check] no candidate files to check. ok.`);
    process.exit(0);
  }

  if (!missing.length) {
    console.log(`${header}\n[registry-check] checked=${candidates.length} missing=0 ok.`);
    process.exit(0);
  }

  console.error(`${header}\n[registry-check] checked=${candidates.length} missing=${missing.length}`);
  for (const m of missing.sort()) console.error(` - ${m}`);

  if (args.mode === "all" && !args.strict) {
    console.log("[registry-check] (non-strict audit) exiting 0");
    process.exit(0);
  }

  process.exit(2);
}

main();
