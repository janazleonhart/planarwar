//worldcore/test/contract_frontendSharedHelperRegistryParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function repoRoot(): string {
  const cwd = process.cwd();
  const direct = path.join(cwd, "web-frontend");
  if (fs.existsSync(direct)) return cwd;
  return path.resolve(__dirname, "../../..");
}

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot(), rel), "utf8");
}

test("[contract] frontend helper imports and shared modules remain registry-represented", () => {
  const registry = JSON.parse(read("web-frontend/WebFrontendRegistry.json"));
  const services = registry.services as Record<string, any>;

  const expected = [
    ["web-frontend.components.worldResponse.worldResponseUi", "web-frontend/components/worldResponse/worldResponseUi.ts"],
    ["web-frontend.components.worldResponse.worldResponsePolishSummaries", "web-frontend/components/worldResponse/worldResponsePolishSummaries.ts"],
    ["web-frontend.components.city.cityPolishSummaries", "web-frontend/components/city/cityPolishSummaries.ts"],
    ["web-frontend.lib.apiTypes", "web-frontend/lib/apiTypes.ts"],
    ["web-frontend.components.city.publicInfrastructureModeToggle", "web-frontend/components/city/PublicInfrastructureModeToggle.tsx"],
    ["web-frontend.components.city.publicInfrastructureSummarySection", "web-frontend/components/city/PublicInfrastructureSummarySection.tsx"],
  ] as const;

  for (const [id, relPath] of expected) {
    assert.ok(services[id], `Registry should include ${id}`);
    assert.equal(services[id].path, relPath, `${id} should point at ${relPath}`);
  }

  const missionResponsePanel = read("web-frontend/components/worldResponse/MissionResponsePanel.tsx");
  assert.match(missionResponsePanel, /from\s+["']\.\/worldResponseUi["']/,
    "MissionResponsePanel should still import ./worldResponseUi");

  const worldResponseSection = read("web-frontend/components/worldResponse/WorldResponseSection.tsx");
  assert.match(worldResponseSection, /from\s+["']\.\/worldResponseUi["']/,
    "WorldResponseSection should still import ./worldResponseUi");
  assert.match(worldResponseSection, /from\s+["']\.\/WorldConsequenceOutlookPanel["']/,
    "WorldResponseSection should still import ./WorldConsequenceOutlookPanel");
  assert.match(worldResponseSection, /from\s+["']\.\/WorldResponsePanel["']/,
    "WorldResponseSection should still import ./WorldResponsePanel");

  const worldResponsePolish = read("web-frontend/components/worldResponse/worldResponsePolishSummaries.ts");
  assert.match(worldResponsePolish, /from\s+["']\.\.\/city\/cityPolishSummaries["']/,
    "worldResponsePolishSummaries should still import ../city/cityPolishSummaries");
  assert.match(worldResponsePolish, /from\s+["']\.\.\/\.\.\/lib\/apiTypes["']/,
    "worldResponsePolishSummaries should still import ../../lib/apiTypes");

  const publicInfraPanel = read("web-frontend/components/city/PublicInfrastructurePanel.tsx");
  assert.match(publicInfraPanel, /from\s+["']\.\/PublicInfrastructureModeToggle["']/,
    "PublicInfrastructurePanel should still import ./PublicInfrastructureModeToggle");
  assert.match(publicInfraPanel, /from\s+["']\.\/PublicInfrastructureSummarySection["']/,
    "PublicInfrastructurePanel should still import ./PublicInfrastructureSummarySection");

  const mePageActionsDeps = services["web-frontend.components.city.mePageActions"].dependsOn || [];
  assert.ok(mePageActionsDeps.includes("web-frontend.components.worldResponse.worldResponseUi"),
    "mePageActions should depend on web-frontend.components.worldResponse.worldResponseUi");

  const publicInfraPanelDeps = services["web-frontend.components.city.publicInfrastructurePanel"].dependsOn || [];
  assert.ok(publicInfraPanelDeps.includes("web-frontend.components.city.publicInfrastructureModeToggle"),
    "publicInfrastructurePanel should depend on publicInfrastructureModeToggle");
  assert.ok(publicInfraPanelDeps.includes("web-frontend.components.city.publicInfrastructureSummarySection"),
    "publicInfrastructurePanel should depend on publicInfrastructureSummarySection");
});
