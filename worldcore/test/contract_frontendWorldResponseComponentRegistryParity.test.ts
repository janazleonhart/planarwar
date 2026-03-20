//worldcore/test/contract_frontendWorldResponseComponentRegistryParity.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(): string {
  const here = __dirname;
  const candidates = [
    path.resolve(here, "../.."),
    path.resolve(here, "../../.."),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "web-frontend", "WebFrontendRegistry.json")) &&
      fs.existsSync(path.join(candidate, "web-frontend", "pages", "MePage.tsx"))
    ) {
      return candidate;
    }
  }
  throw new Error(`Unable to resolve repo root from ${here}`);
}

function mustContain(text: string, needle: string, label: string): void {
  assert.ok(text.includes(needle), label);
}

test("[contract] world response direct-import components are registry-represented", () => {
  const repoRoot = resolveRepoRoot();
  const registryPath = path.join(repoRoot, "web-frontend", "WebFrontendRegistry.json");
  const mePagePath = path.join(repoRoot, "web-frontend", "pages", "MePage.tsx");
  const missionResponsePath = path.join(repoRoot, "web-frontend", "components", "worldResponse", "MissionResponsePanel.tsx");
  const worldResponseSectionPath = path.join(repoRoot, "web-frontend", "components", "worldResponse", "WorldResponseSection.tsx");

  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const services = registry.services as Record<string, { path?: string; dependsOn?: string[] }>;
  const byPath = new Map<string, string>();
  for (const [serviceId, entry] of Object.entries(services)) {
    if (entry.path) byPath.set(entry.path, serviceId);
  }

  const mePageText = fs.readFileSync(mePagePath, "utf8");
  const missionResponseText = fs.readFileSync(missionResponsePath, "utf8");
  const worldResponseSectionText = fs.readFileSync(worldResponseSectionPath, "utf8");

  mustContain(mePageText, 'from "../components/worldResponse/MissionResponsePanel"', "MePage should still directly import MissionResponsePanel");
  mustContain(missionResponseText, 'from "./MissionBoardDigest"', "MissionResponsePanel should still directly import MissionBoardDigest");
  mustContain(missionResponseText, 'from "./CityAlphaPanels"', "MissionResponsePanel should still directly import CityAlphaPanels");
  mustContain(missionResponseText, 'from "./MissionDefenseReceiptsSection"', "MissionResponsePanel should still directly import MissionDefenseReceiptsSection");
  mustContain(missionResponseText, 'from "./MissionPressureMapSection"', "MissionResponsePanel should still directly import MissionPressureMapSection");
  mustContain(missionResponseText, 'from "./MissionWarningWindowsSection"', "MissionResponsePanel should still directly import MissionWarningWindowsSection");
  mustContain(missionResponseText, 'from "./WorldResponseSection"', "MissionResponsePanel should still directly import WorldResponseSection");
  mustContain(worldResponseSectionText, 'from "./WorldConsequenceOutlookPanel"', "WorldResponseSection should still directly import WorldConsequenceOutlookPanel");
  mustContain(worldResponseSectionText, 'from "./WorldResponsePanel"', "WorldResponseSection should still directly import WorldResponsePanel");

  const requiredPaths = [
    "web-frontend/components/worldResponse/MissionResponsePanel.tsx",
    "web-frontend/components/worldResponse/MissionBoardDigest.tsx",
    "web-frontend/components/worldResponse/CityAlphaPanels.tsx",
    "web-frontend/components/worldResponse/MissionDefenseReceiptsSection.tsx",
    "web-frontend/components/worldResponse/MissionPressureMapSection.tsx",
    "web-frontend/components/worldResponse/MissionWarningWindowsSection.tsx",
    "web-frontend/components/worldResponse/WorldResponseSection.tsx",
    "web-frontend/components/worldResponse/WorldConsequenceOutlookPanel.tsx",
    "web-frontend/components/worldResponse/WorldResponsePanel.tsx",
  ];

  for (const componentPath of requiredPaths) {
    assert.ok(byPath.has(componentPath), `Frontend registry should contain a service entry for ${componentPath}`);
  }

  const missionResponseService = services[byPath.get("web-frontend/components/worldResponse/MissionResponsePanel.tsx")!];
  const worldResponseSectionService = services[byPath.get("web-frontend/components/worldResponse/WorldResponseSection.tsx")!];
  const worldResponsePanelService = services[byPath.get("web-frontend/components/worldResponse/WorldResponsePanel.tsx")!];

  assert.ok(missionResponseService.dependsOn?.includes(byPath.get("web-frontend/components/worldResponse/MissionBoardDigest.tsx")!), "MissionResponsePanel registry entry should depend on MissionBoardDigest");
  assert.ok(missionResponseService.dependsOn?.includes(byPath.get("web-frontend/components/worldResponse/WorldResponseSection.tsx")!), "MissionResponsePanel registry entry should depend on WorldResponseSection");
  assert.ok(worldResponseSectionService.dependsOn?.includes(byPath.get("web-frontend/components/worldResponse/WorldConsequenceOutlookPanel.tsx")!), "WorldResponseSection registry entry should depend on WorldConsequenceOutlookPanel");
  assert.ok(worldResponseSectionService.dependsOn?.includes(byPath.get("web-frontend/components/worldResponse/WorldResponsePanel.tsx")!), "WorldResponseSection registry entry should depend on WorldResponsePanel");
  assert.ok(worldResponsePanelService.dependsOn?.includes("web-frontend.components.worldResponse.worldResponseActionsSection"), "WorldResponsePanel registry entry should depend on WorldResponseActionsSection");
});
