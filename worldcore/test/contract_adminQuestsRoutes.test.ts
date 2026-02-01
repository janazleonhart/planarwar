// worldcore/test/contract_adminQuestsRoutes.test.ts
// Contract guard: Admin Quests editor has the backend router file + basic UI wiring.
//
// We keep this regex-based and intentionally non-brittle:
// - verifies /api/admin/quests mount exists in web-backend/index.ts
// - verifies router has GET / and POST /
// - verifies AdminQuestsPage calls /api/admin/quests (GET + POST)
// - verifies AdminQuestsPage uses items options endpoint for item reward picker if present

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

test("[contract] adminQuests backend routes + UI wiring exist", () => {
  const repoRoot = repoRootFromDistTestDir();

  const backendIndexPath = path.join(repoRoot, "web-backend", "index.ts");
  const backendRoutePath = path.join(repoRoot, "web-backend", "routes", "adminQuests.ts");
  const frontendPagePath = path.join(repoRoot, "web-frontend", "pages", "AdminQuestsPage.tsx");

  const backendIndexSrc = readTextOrFail(backendIndexPath);
  const backendRouteSrc = readTextOrFail(backendRoutePath);
  const frontendSrc = readTextOrFail(frontendPagePath);

  // Backend index mounts /api/admin/quests
  mustMatch(
    backendIndexSrc,
    /app\.use\(\s*["']\/api\/admin\/quests["']/,
    "web-backend/index.ts should mount /api/admin/quests",
  );

  // Router must implement GET / and POST /
  mustMatch(
    backendRouteSrc,
    /\brouter\.get\(\s*["']\/?["']\s*,/i,
    "adminQuests router should implement GET /",
  );
  mustMatch(
    backendRouteSrc,
    /\brouter\.post\(\s*["']\/?["']\s*,/i,
    "adminQuests router should implement POST / (upsert)",
  );

  // Frontend must call /api/admin/quests (GET + POST)
  mustContain(frontendSrc, "authedFetch", "AdminQuestsPage should use authedFetch");
  mustAnyMatch(
    frontendSrc,
    [/\/api\/admin\/quests\?/i, /\/api\/admin\/quests[`"']/i],
    "AdminQuestsPage should call /api/admin/quests",
  );
  mustAnyMatch(
    frontendSrc,
    [/method:\s*["']POST["']/i, /\.post\(/i],
    "AdminQuestsPage should perform POST to save/upsert",
  );

  // Optional: item options endpoint for reward item picker (non-fatal if removed later).
  // We assert it exists today because reward UX depends on it in the current editor.
  mustAnyMatch(
    frontendSrc,
    [/\/api\/admin\/items\/options\?/i],
    "AdminQuestsPage should call /api/admin/items/options for reward item picker",
  );

  // Ensure file exports a component (non-brittle)
  mustAnyMatch(
    frontendSrc,
    [
      /\bfunction\s+AdminQuestsPage\b/,
      /\bexport\s+default\s+function\s+AdminQuestsPage\b/,
      /\bconst\s+AdminQuestsPage\b/,
    ],
    "AdminQuestsPage component should exist",
  );
});
