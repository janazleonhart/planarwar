//web-backend/test/monorepoSharedTypeBoundary.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const CANONICAL_SHARED_TYPES = [
  "CityBuilding",
  "CityProduction",
  "CityStats",
  "CityStressState",
  "CitySummary",
  "MissionDefenseReceipt",
  "MissionResponsePosture",
  "MissionSetback",
  "Resources",
  "RewardBundle",
  "ThreatFamily",
] as const;

test("monorepo shared presentation helpers import canonical apiTypes instead of browser runtime api module", () => {
  const citySummaries = readRepoFile("web-frontend/components/city/cityPolishSummaries.ts");
  const worldResponseSummaries = readRepoFile("web-frontend/components/worldResponse/worldResponsePolishSummaries.ts");
  const presentationHelperTest = readRepoFile("web-backend/test/cityPolishPresentationHelpers.test.ts");

  assert.match(citySummaries, /from\s+["']\.\.\/\.\.\/lib\/apiTypes["']/);
  assert.doesNotMatch(citySummaries, /from\s+["']\.\.\/\.\.\/lib\/api["']/);

  assert.match(worldResponseSummaries, /from\s+["']\.\.\/\.\.\/lib\/apiTypes["']/);
  assert.doesNotMatch(worldResponseSummaries, /from\s+["']\.\.\/\.\.\/lib\/api["']/);

  assert.match(presentationHelperTest, /from\s+["']\.\.\/\.\.\/web-frontend\/lib\/apiTypes["']/);
  assert.doesNotMatch(presentationHelperTest, /from\s+["']\.\.\.\/\.\.\/web-frontend\/lib\/api["']/);
});

test("api.ts re-exports canonical shared types without redeclaring them locally", () => {
  const apiModule = readRepoFile("web-frontend/lib/api.ts");

  assert.match(apiModule, /from\s+["']\.\/apiTypes["']/);
  assert.match(apiModule, /export\s+type\s*\{/);

  for (const typeName of CANONICAL_SHARED_TYPES) {
    assert.doesNotMatch(
      apiModule,
      new RegExp(`export\\s+interface\\s+${typeName}\\b`),
      `${typeName} should live in apiTypes.ts, not be redeclared in api.ts`,
    );
    assert.doesNotMatch(
      apiModule,
      new RegExp(`export\\s+type\\s+${typeName}\\b`),
      `${typeName} should live in apiTypes.ts, not be redeclared in api.ts`,
    );
  }
});
