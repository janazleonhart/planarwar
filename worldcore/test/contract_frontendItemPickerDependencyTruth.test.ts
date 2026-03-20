//worldcore/test/contract_frontendItemPickerDependencyTruth.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const here = __dirname;
  const direct = path.resolve(here, "../..");
  if (fs.existsSync(path.join(direct, "web-frontend", "WebFrontendRegistry.json"))) return direct;
  const dist = path.resolve(here, "../../..");
  if (fs.existsSync(path.join(dist, "web-frontend", "WebFrontendRegistry.json"))) return dist;
  throw new Error(`Unable to resolve repo root from ${here}`);
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("[contract] ItemPicker literal admin API usage declares backend route dependency", () => {
  const repoRoot = resolveRepoRoot();
  const frontendRegistry = readJson(path.join(repoRoot, "web-frontend", "WebFrontendRegistry.json"));
  const backendRegistry = readJson(path.join(repoRoot, "web-backend", "WebBackendRegistry.json"));
  const itemPickerPath = path.join(repoRoot, "web-frontend", "components", "ItemPicker.tsx");
  const source = fs.readFileSync(itemPickerPath, "utf8");

  assert.ok(
    source.includes('/api/admin/items/options'),
    'ItemPicker.tsx should still contain literal usage for /api/admin/items/options',
  );

  const frontendService = frontendRegistry.services['web-frontend.components.itemPicker'];
  assert.ok(frontendService, 'Frontend registry should contain web-frontend.components.itemPicker');
  assert.equal(frontendService.path, 'web-frontend/components/ItemPicker.tsx');
  assert.ok(
    Array.isArray(frontendService.dependsOn) && frontendService.dependsOn.includes('web-backend.routes.adminItems'),
    'web-frontend.components.itemPicker should depend on web-backend.routes.adminItems',
  );

  const backendService = backendRegistry.services['web-backend.routes.adminItems'];
  assert.ok(backendService, 'Backend registry should contain web-backend.routes.adminItems');
  const haystack = [
    ...(backendService.provides ?? []),
    ...(backendService.notes ?? []),
    ...(backendService.owns ?? []),
  ].join('\n');
  assert.ok(
    haystack.includes('/api/admin/items/options'),
    'web-backend.routes.adminItems should document /api/admin/items/options',
  );
});
