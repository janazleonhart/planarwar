// worldcore/test/contract_adminNpcsRoutes.test.ts
// Contract guard: Admin NPC editor has the backend router file + basic UI wiring.
//
// We keep this regex-based and intentionally non-brittle:
// - verifies /api/admin/npcs mount exists in web-backend/index.ts
// - verifies router has GET / and POST /
// - verifies AdminNpcsPage calls /api/admin/npcs (GET + POST)

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

function readTextOrFail(p: string): string {
  assert.ok(fs.existsSync(p), `Missing expected file: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function mustMatch(haystack: string, re: RegExp, msg: string): void {
  assert.ok(re.test(haystack), msg);
}

function mustContain(haystack: string, needle: string, msg: string): void {
  assert.ok(haystack.includes(needle), msg);
}

function mustAnyMatch(haystack: string, res: RegExp[], msg: string): void {
  assert.ok(res.some((r) => r.test(haystack)), msg);
}

test("[contract] adminNpcs backend routes + UI wiring exist", () => {
  const repoRoot = repoRootFromDistTestDir();

  const backendIndexPath = path.join(repoRoot, "web-backend", "index.ts");
  const backendRoutePath = path.join(repoRoot, "web-backend", "routes", "adminNpcs.ts");
  const frontendPagePath = path.join(repoRoot, "web-frontend", "pages", "AdminNpcsPage.tsx");

  const backendIndexSrc = readTextOrFail(backendIndexPath);
  const backendRouteSrc = readTextOrFail(backendRoutePath);
  const frontendSrc = readTextOrFail(frontendPagePath);

  // Backend index mounts /api/admin/npcs
  mustMatch(
    backendIndexSrc,
    /app\.use\(\s*["']\/api\/admin\/npcs["']/,
    "web-backend/index.ts should mount /api/admin/npcs",
  );

  // Router must implement GET / and POST /
  mustMatch(
    backendRouteSrc,
    /\brouter\.get\(\s*["']\/?["']\s*,/i,
    "adminNpcs router should implement GET /",
  );
  mustMatch(
    backendRouteSrc,
    /\brouter\.post\(\s*["']\/?["']\s*,/i,
    "adminNpcs router should implement POST / (upsert)",
  );

  // Frontend must call /api/admin/npcs (GET + POST)
  mustContain(frontendSrc, "authedFetch", "AdminNpcsPage should use authedFetch");
  mustAnyMatch(
    frontendSrc,
    [/\/api\/admin\/npcs\?/i, /\/api\/admin\/npcs[`"']/i],
    "AdminNpcsPage should call /api/admin/npcs",
  );
  mustAnyMatch(
    frontendSrc,
    [/method:\s*["']POST["']/i, /\.post\(/i],
    "AdminNpcsPage should perform POST to save/upsert",
  );

  // Ensure file exports a component (non-brittle)
  mustAnyMatch(
    frontendSrc,
    [
      /\bfunction\s+AdminNpcsPage\b/,
      /\bexport\s+default\s+function\s+AdminNpcsPage\b/,
      /\bconst\s+AdminNpcsPage\b/,
    ],
    "AdminNpcsPage component should exist",
  );
});
