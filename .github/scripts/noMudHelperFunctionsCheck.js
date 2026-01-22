/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCAN_ROOT = path.join(REPO_ROOT, "worldcore");

// Only scan code + registry-ish files where it matters.
// (Docs can mention it historically without breaking the build.)
const ALLOWED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".cache",
]);

const NEEDLES = [
  "MudHelperFunctions",
  "mud/MudHelperFunctions",
  "mud\\MudHelperFunctions", // windows path variant, just in case
];

function isIgnoredDir(name) {
  return IGNORE_DIRS.has(name);
}

function shouldScanFile(filePath) {
  const ext = path.extname(filePath);
  return ALLOWED_EXTS.has(ext);
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (isIgnoredDir(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.isFile()) {
      const fp = path.join(dir, e.name);
      if (shouldScanFile(fp)) out.push(fp);
    }
  }
  return out;
}

function findMatches(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const needle of NEEDLES) {
      if (line.includes(needle)) {
        hits.push({ lineNo: i + 1, line });
        break;
      }
    }
  }
  return hits;
}

function main() {
  if (!fs.existsSync(SCAN_ROOT)) {
    console.error(`[noMudHelperFunctionsCheck] Missing dir: ${SCAN_ROOT}`);
    process.exit(2);
  }

  const files = walk(SCAN_ROOT);
  const violations = [];

  for (const fp of files) {
    const matches = findMatches(fp);
    if (matches.length) {
      violations.push({ fp, matches });
    }
  }

  if (violations.length) {
    console.error("❌ MudHelperFunctions references detected (must remain retired):");
    for (const v of violations) {
      const rel = path.relative(REPO_ROOT, v.fp);
      for (const m of v.matches.slice(0, 10)) {
        console.error(`  ${rel}:${m.lineNo}: ${m.line}`);
      }
      if (v.matches.length > 10) {
        console.error(`  ...and ${v.matches.length - 10} more match(es) in ${rel}`);
      }
    }
    process.exit(1);
  }

  console.log("✅ noMudHelperFunctionsCheck: OK (no references found)");
  process.exit(0);
}

main();
