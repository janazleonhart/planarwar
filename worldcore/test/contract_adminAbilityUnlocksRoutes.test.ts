// worldcore/test/contract_adminAbilityUnlocksRoutes.test.ts
// Contract guard: Admin Ability Unlocks editor has backend routes + basic UI wiring.

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

test("[contract] adminAbilityUnlocks backend routes + UI wiring exist", () => {
  const repoRoot = repoRootFromDistTestDir();

  const backendIndexPath = path.join(repoRoot, "web-backend", "index.ts");
  const backendPath = path.join(repoRoot, "web-backend", "routes", "adminAbilityUnlocks.ts");
  const frontendPath = path.join(repoRoot, "web-frontend", "pages", "AdminAbilitiesPage.tsx");

  const backendIndexSrc = readTextOrFail(backendIndexPath);
  const backendSrc = readTextOrFail(backendPath);
  const frontendSrc = readTextOrFail(frontendPath);

  // Mounted under /api/admin/ability_unlocks
  mustMatch(backendIndexSrc, /app\.use\(\s*["']\/api\/admin\/ability_unlocks["']/, "web-backend/index.ts should mount /api/admin/ability_unlocks");
  mustMatch(backendIndexSrc, /maybeRequireAdmin\(\s*["']\/api\/admin\/ability_unlocks["']\s*\)/, "mount should be gated via maybeRequireAdmin");

  // Backend: list route exists (GET /)
  mustMatch(backendSrc, /\badminAbilityUnlocksRouter\.get\(\s*["']\/?["']\s*,/m, "adminAbilityUnlocks router should implement GET /");

  // Backend: upsert route exists (POST /)
  mustMatch(backendSrc, /\badminAbilityUnlocksRouter\.post\(\s*["']\/?["']\s*,/m, "adminAbilityUnlocks router should implement POST /");

  // UI: should call /api/admin/ability_unlocks
  mustContain(frontendSrc, "/api/admin/ability_unlocks", "AdminAbilitiesPage should call /api/admin/ability_unlocks");
});
