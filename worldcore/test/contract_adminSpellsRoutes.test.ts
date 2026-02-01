// worldcore/test/contract_adminSpellsRoutes.test.ts
// Contract guard: Admin Spells editor has the backend router file + basic UI wiring.
//
// NOTE: We intentionally do NOT require the UI to call GET /api/admin/spells/:id.
// The current UI can (validly) operate from the list payload alone.

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

function mustContain(haystack: string, needle: string, msg: string): void {
  assert.ok(haystack.includes(needle), msg);
}

function mustMatch(haystack: string, re: RegExp, msg: string): void {
  assert.ok(re.test(haystack), msg);
}

test("[contract] adminSpells backend routes + UI wiring exist", () => {
  const repoRoot = repoRootFromDistTestDir();

  const backendPath = path.join(repoRoot, "web-backend", "routes", "adminSpells.ts");
  const frontendPath = path.join(repoRoot, "web-frontend", "pages", "AdminSpellsPage.tsx");

  const backendSrc = readTextOrFail(backendPath);
  const frontendSrc = readTextOrFail(frontendPath);

  // Backend: router exists + list route exists.
  // Router variable name may vary (router, adminSpellsRouter, etc.).
  mustMatch(
    backendSrc,
    /\b\w*Router\.get\(\s*["']\/?["']\s*,/,
    "adminSpells router should implement GET /",
  );

  // Backend: list route should be able to read req.query.q (search) and paging.
  // (Loose check to avoid coupling to the exact SQL string builder.)
  mustContain(backendSrc, "req.query", "adminSpells GET / should reference req.query");
  mustMatch(backendSrc, /\bq\b/, "adminSpells GET / should support a q query param (search)");
  mustMatch(backendSrc, /\blimit\b/i, "adminSpells GET / should support limit");
  mustMatch(backendSrc, /\boffset\b/i, "adminSpells GET / should support offset");

  // Backend: ensure single-row route exists even if the UI doesn't currently call it.
  mustMatch(
    backendSrc,
    /\b\w*Router\.get\(\s*["']\/:id["']\s*,/,
    "adminSpells router should implement GET /:id",
  );

  // Frontend: page exists, uses authedFetch, and calls the list endpoint.
  mustContain(frontendSrc, "function AdminSpellsPage", "AdminSpellsPage component should exist");
  mustContain(frontendSrc, "authedFetch", "AdminSpellsPage should use authedFetch");

  // We accept either a literal '?q=' construction OR a URLSearchParams builder.
  mustMatch(
    frontendSrc,
    /\/api\/admin\/spells\?/,
    "AdminSpellsPage should call GET /api/admin/spells?...",
  );

  // If using URLSearchParams, ensure it sets q.
  // This keeps the contract resilient to minor refactors.
  assert.ok(
    frontendSrc.includes('qs.set("q"') || frontendSrc.includes("qs.set('q'"),
    "AdminSpellsPage should support search via qs.set('q', ...)",
  );
});
