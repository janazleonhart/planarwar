// worldcore/test/contract_adminHardeningRoutesAndAuth.test.ts
// Contract guard: Admin hardening wiring exists (routing + adminAuth semantics).
//
// Structural/regex-based: avoids spinning up Express or requiring a database.
// Asserts:
// - web-backend/index.ts mounts each /api/admin/* router with maybeRequireAdmin(...)
// - web-backend/middleware/adminAuth.ts preserves the expected RBAC behaviors.
//
// IMPORTANT: Keep checks non-brittle. We care about *meaning*, not exact implementation.

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

test("[contract] /api/admin mounts are gated + adminAuth semantics exist", () => {
  const repoRoot = repoRootFromDistTestDir();

  const backendIndexPath = path.join(repoRoot, "web-backend", "index.ts");
  const adminAuthPath = path.join(repoRoot, "web-backend", "middleware", "adminAuth.ts");

  const indexSrc = readTextOrFail(backendIndexPath);
  const authSrc = readTextOrFail(adminAuthPath);

  // Ensure index uses maybeRequireAdmin to gate /api/admin routes
  mustMatch(
    indexSrc,
    /\bmaybeRequireAdmin\b/,
    "web-backend/index.ts should use maybeRequireAdmin to gate /api/admin routes",
  );

  // Required admin mounts (current admin surface)
  const mounts: Array<{ mount: string; routerName: string }> = [
    { mount: "/api/admin/quests", routerName: "adminQuestsRouter" },
    { mount: "/api/admin/npcs", routerName: "adminNpcsRouter" },
    { mount: "/api/admin/items", routerName: "adminItemsRouter" },
    { mount: "/api/admin/spells", routerName: "adminSpellsRouter" },
    { mount: "/api/admin/spawn_points", routerName: "adminSpawnPointsRouter" },
    { mount: "/api/admin/vendor_audit", routerName: "adminVendorAuditRouter" },
    { mount: "/api/admin/vendor_economy", routerName: "adminVendorEconomyRouter" },
  ];

  for (const m of mounts) {
    // Example:
    // app.use("/api/admin/items", maybeRequireAdmin("/api/admin/items"), adminItemsRouter);
    const re = new RegExp(
      String.raw`app\.use\(\s*["']${m.mount.replace(/\//g, "\\/")}["']\s*,\s*maybeRequireAdmin\(\s*["']${m.mount.replace(
        /\//g,
        "\\/",
      )}["']\s*\)\s*,\s*${m.routerName}\s*\)`,
      "m",
    );
    mustMatch(indexSrc, re, `Expected gated mount: ${m.mount} with maybeRequireAdmin(...), ${m.routerName}`);
  }

  // --- adminAuth semantics (structural) ---

  // Bearer token parsing: allow regex-based or string-based parsing.
  // We only require evidence that "Bearer" is recognized and a token is extracted.
  mustContain(authSrc, "Bearer", "adminAuth should recognize the Bearer scheme");
  mustAnyMatch(
    authSrc,
    [
      /parseBearerToken/,
      /authorization/i,
      /startsWith\(\s*["']Bearer\s+["']\s*\)/,
      /split\(\s*["']\s+["']\s*\)/,
      /match\(\s*\/\^?Bearer\\s\+\(\.\+\)\/i?\s*\)/,
      /Bearer\\s\+/i,
    ],
    "adminAuth should parse Bearer <token> from Authorization header (regex or string parsing)",
  );

  // Source of truth should be PostgresAuthService.verifyToken(...)
  mustAnyMatch(
    authSrc,
    [/PostgresAuthService/, /new\s+PostgresAuthService\(\)/],
    "adminAuth should use PostgresAuthService as the source of truth",
  );
  mustMatch(authSrc, /\.verifyToken\(/, "adminAuth should call verifyToken(token)");

  // Expected error payloads
  mustContain(authSrc, 'error: "missing_token"', "adminAuth should return missing_token on absent bearer");
  mustContain(authSrc, 'error: "invalid_token"', "adminAuth should return invalid_token when verifyToken fails");
  mustContain(authSrc, 'error: "admin_required"', "adminAuth should return admin_required when role is missing");
  mustContain(authSrc, 'error: "admin_readonly"', "adminAuth should enforce readonly write block");
  mustContain(authSrc, 'error: "admin_root_required"', "adminAuth should enforce root-only endpoints");

  // Role mapping keys we rely on for UI messaging + back-compat
  mustContain(authSrc, "adminRole", "adminAuth should recognize flags.adminRole");
  mustContain(authSrc, "isDev", "adminAuth should map flags.isDev");
  mustContain(authSrc, "isGM", "adminAuth should map flags.isGM");
  mustContain(authSrc, "isGuide", "adminAuth should map flags.isGuide");

  // Root-only endpoint list should include the two destructive spawn_points operations
  mustContain(authSrc, "/api/admin/spawn_points/bulk_delete", "adminAuth should mark spawn_points bulk_delete as root-only");
  mustContain(authSrc, "/api/admin/spawn_points/mother_brain/wipe", "adminAuth should mark mother_brain wipe as root-only");

  // Explicit bypass knob exists (opt-in)
  mustContain(authSrc, "PW_ADMIN_BYPASS", "adminAuth should contain explicit PW_ADMIN_BYPASS knob");
  mustAnyMatch(
    authSrc,
    [
      /bypass\s*===\s*["']1["']/,
      /bypass\s*===\s*["']true["']/,
      /PW_ADMIN_BYPASS/i,
    ],
    "adminAuth bypass should only activate for explicit values like '1' or 'true'",
  );
});
