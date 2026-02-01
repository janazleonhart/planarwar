// worldcore/test/contract_adminAbilitiesRoutes.test.ts
// Contract guard: Admin Abilities editor has backend routes + basic UI wiring.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
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

test("[contract] adminAbilities backend routes + UI wiring exist", () => {
  const repoRoot = repoRootFromDistTestDir();

  const backendIndexPath = path.join(repoRoot, "web-backend", "index.ts");
  const backendPath = path.join(repoRoot, "web-backend", "routes", "adminAbilities.ts");
  const frontendPath = path.join(repoRoot, "web-frontend", "pages", "AdminAbilitiesPage.tsx");
  const hubPath = path.join(repoRoot, "web-frontend", "pages", "AdminHubPage.tsx");

  const backendIndexSrc = readTextOrFail(backendIndexPath);
  const backendSrc = readTextOrFail(backendPath);
  const frontendSrc = readTextOrFail(frontendPath);
  const hubSrc = readTextOrFail(hubPath);

  // Mounted under /api/admin/abilities
  mustMatch(backendIndexSrc, /app\.use\(\s*["']\/api\/admin\/abilities["']/, "web-backend/index.ts should mount /api/admin/abilities");
  mustMatch(backendIndexSrc, /maybeRequireAdmin\(\s*["']\/api\/admin\/abilities["']\s*\)/, "mount should be gated via maybeRequireAdmin");

  // Backend: list route exists (GET /)
  mustMatch(backendSrc, /\badminAbilitiesRouter\.get\(\s*["']\/?["']\s*,/m, "adminAbilities router should implement GET /");

  // Backend: upsert route exists (POST /)
  mustMatch(backendSrc, /\badminAbilitiesRouter\.post\(\s*["']\/?["']\s*,/m, "adminAbilities router should implement POST /");

  // UI: should call /api/admin/abilities
  mustContain(frontendSrc, "/api/admin/abilities", "AdminAbilitiesPage should call /api/admin/abilities");

  // Hub link exists
  mustContain(hubSrc, 'path: "/admin/abilities"', "AdminHubPage should link to /admin/abilities");
});
