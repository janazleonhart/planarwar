// worldcore/test/contract_adminSpawnPointsMotherBrainRoutes.test.ts
//
// Lane G (contract):
// Keep Mother Brain wave/wipe plumbing consistent between:
// - web-backend/routes/adminSpawnPoints.ts (Express routes)
// - web-frontend/pages/AdminSpawnPointsPage.tsx (Admin UI)
//
// Why:
// This regresses easily during UI refactors (404s) or backend refactors
// (bounds parsing accidentally skipped, causing silent wouldInsert=0 behavior).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRootFromDistTestDir(): string {
  // __dirname = <repo>/dist/worldcore/test
  return path.resolve(__dirname, "../../..");
}

function readUtf8(root: string, rel: string): string {
  const full = path.join(root, rel);
  assert.ok(fs.existsSync(full), `Expected file to exist: ${rel} (${full})`);
  return fs.readFileSync(full, "utf8");
}

function stripComments(src: string): string {
  // Strip /* ... */ first.
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");

  // Strip // ... per line.
  return noBlock
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

test("[contract] Mother Brain wave/wipe routes exist and UI targets them", () => {
  const root = repoRootFromDistTestDir();

  const backendRel = "web-backend/routes/adminSpawnPoints.ts";
  const frontendRel = "web-frontend/pages/AdminSpawnPointsPage.tsx";

  const backend = stripComments(readUtf8(root, backendRel));
  const frontend = stripComments(readUtf8(root, frontendRel));

  // Backend: route literals must exist.
  assert.ok(
    /router\.(?:post|get)\(\s*["']\/mother_brain\/wave["']/.test(backend),
    `${backendRel} must define a /mother_brain/wave route (router.post or router.get)`
  );
  assert.ok(
    /router\.(?:post|get)\(\s*["']\/mother_brain\/wipe["']/.test(backend),
    `${backendRel} must define a /mother_brain/wipe route (router.post or router.get)`
  );

  // Frontend: must call the expected API endpoints.
  // (We match the full path to prevent accidental /admin/* vs /api/admin/* drift.)
  assert.ok(
    /\/api\/admin\/spawn_points\/mother_brain\/wave/.test(frontend),
    `${frontendRel} must call /api/admin/spawn_points/mother_brain/wave`
  );
  assert.ok(
    /\/api\/admin\/spawn_points\/mother_brain\/wipe/.test(frontend),
    `${frontendRel} must call /api/admin/spawn_points/mother_brain/wipe`
  );

  // Backend: bounds MUST be parsed and the parsed bounds must be used for planning/wiping.
  // (This prevents the classic silent failure where a string slips through.)
  assert.ok(
    /parseCellBounds\(/.test(backend),
    `${backendRel} must parse bounds via parseCellBounds(...)`
  );

  // We accept either:
  //   bounds: parsedBounds
  // or a function call argument that includes parsedBounds.
  const usesParsedBoundsInPlanner =
    /\bbounds\s*:\s*parsedBounds\b/.test(backend) ||
    /\bparsedBounds\b/.test(backend) && /planBrainWave\s*\(/.test(backend);

  assert.ok(
    usesParsedBoundsInPlanner,
    `${backendRel} must pass parsedBounds into planning (not the raw bounds string)`
  );
});
