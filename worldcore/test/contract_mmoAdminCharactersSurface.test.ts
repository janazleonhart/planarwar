// worldcore/test/contract_mmoAdminCharactersSurface.test.ts
// Contract guard: MMO backend admin character HTTP surface stays aligned with registry truth.
//
// Structural/regex-based: avoids spinning up the HTTP server or touching Postgres.
// Asserts:
// - mmo-backend/server.ts exposes the expected POST /api/admin/characters/* endpoints
// - the handler enforces service-token auth + editor/root role checks
// - MmoBackendRegistry.json documents the same live endpoints

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

function mustContain(haystack: string, needle: string, msg: string): void {
  assert.ok(haystack.includes(needle), msg);
}

const ENDPOINTS = [
  "/api/admin/characters/create",
  "/api/admin/characters/rename",
  "/api/admin/characters/delete",
  "/api/admin/characters/smoke_cycle",
] as const;

test("[contract] mmo admin character endpoints and registry stay aligned", () => {
  const repoRoot = repoRootFromDistTestDir();

  const serverPath = path.join(repoRoot, "mmo-backend", "server.ts");
  const registryPath = path.join(repoRoot, "mmo-backend", "MmoBackendRegistry.json");

  const serverSrc = readTextOrFail(serverPath);
  const registry = JSON.parse(readTextOrFail(registryPath)) as {
    services?: Record<string, { provides?: string[]; notes?: string[] }>;
  };

  mustContain(
    serverSrc,
    'pathname.startsWith("/api/admin/characters/")',
    'mmo-backend/server.ts should contain the /api/admin/characters/ handler block',
  );
  mustContain(serverSrc, 'verifyServiceToken(token)', 'mmo-backend/server.ts should verify service tokens for admin character endpoints');
  mustContain(
    serverSrc,
    'if (v.role !== "editor" && v.role !== "root")',
    'mmo-backend/server.ts should restrict admin character endpoints to editor/root roles',
  );
  mustContain(serverSrc, 'if (req.method !== "POST")', 'mmo-backend/server.ts should keep admin character endpoints POST-only');

  for (const endpoint of ENDPOINTS) {
    mustContain(serverSrc, `pathname === "${endpoint}"`, `mmo-backend/server.ts should expose ${endpoint}`);
  }

  const entryProvides = registry.services?.["mmo-backend.entry"]?.provides ?? [];
  const routeProvides = registry.services?.["mmo-backend.routes.adminCharactersSmokeCycle"]?.provides ?? [];
  const routeNotes = registry.services?.["mmo-backend.routes.adminCharactersSmokeCycle"]?.notes ?? [];

  mustContain(
    entryProvides.join("\n"),
    "/api/admin/characters/create|rename|delete|smoke_cycle",
    'MmoBackendRegistry.json mmo-backend.entry should advertise the full admin character HTTP surface',
  );

  for (const endpoint of ENDPOINTS) {
    mustContain(
      routeProvides.join("\n"),
      endpoint,
      `MmoBackendRegistry.json mmo-backend.routes.adminCharactersSmokeCycle should document ${endpoint}`,
    );
  }

  mustContain(
    routeNotes.join("\n"),
    'role editor/root',
    'MmoBackendRegistry.json should preserve the editor/root authorization note for admin character endpoints',
  );
});
