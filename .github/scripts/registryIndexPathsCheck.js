#!/usr/bin/env node
"use strict";

/**
 * RegistryIndex + registry path validation (glob-aware)
 *
 * Checks:
 * - RegistryIndex.json exists + parses
 * - Each registry listed in RegistryIndex exists + parses
 * - Each registry entry with a "path" is validated:
 *    - Normal paths: must exist (file or directory)
 *    - Glob paths (e.g. foo/*.json): must match at least one file
 *
 * Notes:
 * - Keeps your hybrid registry style (service graph entries + file catalog entries).
 * - Does NOT enforce that registry keys match entry.path; it only validates the referenced paths.
 * - Adds better diagnostics for case issues (Linux) without mutating files.
 */

const fs = require("node:fs");
const path = require("node:path");

function out(msg) {
  process.stdout.write(`${msg}\n`);
}
function warn(msg) {
  process.stderr.write(`[WARN] ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`[ERROR] ${msg}\n`);
  process.exitCode = 1;
}

function normalizeSlashes(p) {
  return String(p || "").replace(/\\/g, "/");
}

function safeResolve(repoRoot, relPath) {
  const abs = path.resolve(repoRoot, relPath);
  const root = path.resolve(repoRoot);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    fail(`Path escapes repo root: ${relPath}`);
    return null;
  }
  return abs;
}

function readJson(absPath, labelForErrors) {
  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch (e) {
    fail(`Failed to read ${labelForErrors}: ${e?.message || String(e)}`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`Invalid JSON in ${labelForErrors}: ${e?.message || String(e)}`);
    return null;
  }
}

function exists(absPath) {
  try {
    fs.accessSync(absPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isGlobPath(relPath) {
  const p = normalizeSlashes(relPath);
  // Simple glob detection: *, ?, or [] patterns
  return /[*?\[]/.test(p);
}

function segmentToRegex(seg) {
  // Supports * and ? and [] literally if present (we don't expand [] ranges).
  const esc = seg.replace(/[.+^${}()|\\]/g, "\\$&");
  const re = esc.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`);
}

function listDir(absDir) {
  try {
    return fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Case-insensitive resolver for nicer error messages on Linux.
 * Returns a normalized relative path with correct casing if it can be resolved,
 * else null.
 */
function resolveCaseInsensitive(repoRoot, relPath) {
  const rel = normalizeSlashes(relPath);
  const parts = rel.split("/").filter(Boolean);

  let curAbs = path.resolve(repoRoot);
  const built = [];

  for (const part of parts) {
    const entries = listDir(curAbs);
    let found = null;

    for (const ent of entries) {
      if (ent.name.toLowerCase() === part.toLowerCase()) {
        found = ent.name;
        break;
      }
    }

    if (!found) return null;

    built.push(found);
    curAbs = path.join(curAbs, found);
  }

  const candidateRel = built.join("/");
  const candidateAbs = safeResolve(repoRoot, candidateRel);
  if (!candidateAbs) return null;
  return exists(candidateAbs) ? candidateRel : null;
}

/**
 * Expand a simple glob pattern by walking directories.
 * Supports:
 * - * and ? in path segments
 * - ** as "match any directories"
 *
 * Returns matched absolute file paths.
 */
function expandGlob(repoRoot, relPattern) {
  const pattern = normalizeSlashes(relPattern);
  const parts = pattern.split("/").filter(Boolean);

  const rootAbs = path.resolve(repoRoot);
  const matches = [];

  function walk(curAbs, idx) {
    if (idx >= parts.length) return;

    const seg = parts[idx];

    if (seg === "**") {
      // Option A: ** matches zero segments
      walk(curAbs, idx + 1);

      // Option B: ** matches one+ directory segments
      for (const ent of listDir(curAbs)) {
        if (ent.isDirectory()) {
          walk(path.join(curAbs, ent.name), idx);
        }
      }
      return;
    }

    const rx = segmentToRegex(seg);
    const isLast = idx === parts.length - 1;

    for (const ent of listDir(curAbs)) {
      if (!rx.test(ent.name)) continue;

      const nextAbs = path.join(curAbs, ent.name);

      if (isLast) {
        if (ent.isFile()) matches.push(nextAbs);
      } else {
        if (ent.isDirectory()) walk(nextAbs, idx + 1);
      }
    }
  }

  // Find the deepest non-glob prefix so we don’t start at repo root unnecessarily.
  // If the prefix itself doesn't exist, we fail earlier in the caller.
  walk(rootAbs, 0);
  return matches;
}

function main() {
  const repoRoot = process.cwd();

  const indexRel = "RegistryIndex.json";
  const indexAbs = safeResolve(repoRoot, indexRel);
  if (!indexAbs) return;

  if (!exists(indexAbs)) {
    fail(`Missing ${indexRel} at repo root.`);
    return;
  }

  const index = readJson(indexAbs, indexRel);
  if (!index) return;

  const registries = index.registries;
  if (!Array.isArray(registries)) {
    fail(`RegistryIndex.json: "registries" must be an array.`);
    return;
  }

  let registriesChecked = 0;
  let entriesChecked = 0;
  let missing = 0;

  for (const reg of registries) {
    if (!reg || typeof reg !== "object") continue;
    if (typeof reg.path !== "string" || !reg.path.trim()) continue;

    const regRel = normalizeSlashes(reg.path);
    const regAbs = safeResolve(repoRoot, regRel);
    if (!regAbs) continue;

    registriesChecked++;

    if (!exists(regAbs)) {
      missing++;
      fail(`Missing registry file: ${regRel}`);
      continue;
    }

    const registryJson = readJson(regAbs, regRel);
    if (!registryJson) continue;

    const services = registryJson.services;
    if (!services || typeof services !== "object") {
      warn(`Registry has no "services" object (skipping service checks): ${regRel}`);
      continue;
    }

    for (const [key, entry] of Object.entries(services)) {
      if (!entry || typeof entry !== "object") continue;

      const entryPath = entry.path;
      if (entryPath == null) {
        // allowed: conceptual entries
        continue;
      }

      if (typeof entryPath !== "string" || !entryPath.trim()) {
        missing++;
        fail(`Invalid path: ${regRel} :: ${key} -> ${String(entryPath)}`);
        continue;
      }

      const rel = normalizeSlashes(entryPath);
      entriesChecked++;

      if (isGlobPath(rel)) {
        // Glob must match at least one file
        const matches = expandGlob(repoRoot, rel);
        if (!matches.length) {
          missing++;
          fail(`Glob matched no files: ${regRel} :: ${key} -> ${rel}`);
        }
        continue;
      }

      const abs = safeResolve(repoRoot, rel);
      if (!abs) continue;

      if (exists(abs)) continue;

      // Missing: try case-insensitive hint
      const hint = resolveCaseInsensitive(repoRoot, rel);
      missing++;
      if (hint) {
        fail(`Missing path (case mismatch?): ${regRel} :: ${key} -> ${rel} (did you mean ${hint}?)`);
      } else {
        fail(`Missing path: ${regRel} :: ${key} -> ${rel}`);
      }
    }
  }

  if (process.exitCode && process.exitCode !== 0) {
    fail(
      `Registry path check FAILED: registriesChecked=${registriesChecked} entriesChecked=${entriesChecked} missing=${missing}`
    );
  } else {
    out(`Registry path check OK: registriesChecked=${registriesChecked} entriesChecked=${entriesChecked}`);
  }
}

main();
