// worldcore/test/contract_adminItemsRoutes.test.ts
// Contract guard: Admin Items editor has the backend router file + basic UI wiring.
//
// This mirrors the adminSpells contract: existence + endpoint wiring checks,
// without coupling to exact UI structure or exact query-param builder implementation.

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

function mustAnyMatch(haystack: string, res: RegExp[], msg: string): void {
  assert.ok(res.some((r) => r.test(haystack)), msg);
}

test("[contract] adminItems backend routes + UI wiring exist", () => {
  const repoRoot = repoRootFromDistTestDir();

  const backendIndexPath = path.join(repoRoot, "web-backend", "index.ts");
  const backendPath = path.join(repoRoot, "web-backend", "routes", "adminItems.ts");
  const frontendPath = path.join(repoRoot, "web-frontend", "pages", "AdminItemsPage.tsx");
  const pickerPath = path.join(repoRoot, "web-frontend", "components", "ItemPicker.tsx");

  const backendIndexSrc = readTextOrFail(backendIndexPath);
  const backendSrc = readTextOrFail(backendPath);
  const frontendSrc = readTextOrFail(frontendPath);
  const pickerSrc = readTextOrFail(pickerPath);

  // Backend index: mounted under /api/admin/items
  mustMatch(
    backendIndexSrc,
    /app\.use\(\s*["']\/api\/admin\/items["']/,
    "web-backend/index.ts should mount /api/admin/items",
  );

  // Backend: list route exists (GET /)
  mustMatch(
    backendSrc,
    /\b\w*Router\.get\(\s*["']\/?["']\s*,/,
    "adminItems router should implement GET /",
  );

  // Backend: list route should reference req.query + q/limit/offset
  mustContain(backendSrc, "req.query", "adminItems GET / should reference req.query");
  mustMatch(backendSrc, /\bq\b/, "adminItems GET / should support a q query param (search)");
  mustMatch(backendSrc, /\blimit\b/i, "adminItems GET / should support limit");
  mustMatch(backendSrc, /\boffset\b/i, "adminItems GET / should support offset");

  // Backend: options endpoint for typeahead (GET /options)
  mustMatch(
    backendSrc,
    /\b\w*Router\.get\(\s*["']\/options["']\s*,/,
    "adminItems router should implement GET /options for ItemPicker",
  );

  // Backend: upsert endpoint (POST /)
  mustMatch(
    backendSrc,
    /\b\w*Router\.post\(\s*["']\/?["']\s*,/,
    "adminItems router should implement POST / (upsert)",
  );

  // Frontend: AdminItems page exists + calls list endpoint
  mustAnyMatch(
    frontendSrc,
    [
      /\bfunction\s+AdminItemsPage\b/,
      /\bconst\s+AdminItemsPage\b/,
      /\bexport\s+default\s+function\s+AdminItemsPage\b/,
      /\bAdminItemsPage\b/,
    ],
    "AdminItemsPage component should exist",
  );
  mustContain(frontendSrc, "authedFetch", "AdminItemsPage should use authedFetch");
  mustAnyMatch(
    frontendSrc,
    [
      /\/api\/admin\/items\?/,
      /\/api\/admin\/items["'`]/,
    ],
    "AdminItemsPage should call /api/admin/items",
  );

  // Query param builder: accept URLSearchParams or manual q/limit/offset concatenation.
  // We only require evidence that q/limit/offset are included in the request.
  mustAnyMatch(
    frontendSrc,
    [
      /\.set\(\s*["']q["']/,
      /[?&]q=/,
      /encodeURIComponent\(\s*q\s*\)/,
    ],
    "AdminItemsPage should include search (q) in the request URL",
  );
  mustAnyMatch(
    frontendSrc,
    [
      /\.set\(\s*["']limit["']/,
      /[?&]limit=/,
    ],
    "AdminItemsPage should include limit in the request URL",
  );
  mustAnyMatch(
    frontendSrc,
    [
      /\.set\(\s*["']offset["']/,
      /[?&]offset=/,
    ],
    "AdminItemsPage should include offset in the request URL",
  );

  // ItemPicker: calls /api/admin/items/options
  mustContain(pickerSrc, "ItemPicker", "ItemPicker component should exist");
  mustContain(pickerSrc, "authedFetch", "ItemPicker should use authedFetch");
  mustMatch(
    pickerSrc,
    /\/api\/admin\/items\/options\?/,
    "ItemPicker should call GET /api/admin/items/options?...",
  );
});
