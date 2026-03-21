//worldcore/test/contract_frontendSettlementLaneContinuityTruth.test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function resolveRepoRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", ".."),
    "/home/rimuru/planarwar",
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "web-frontend", "components", "city", "CityCorePanel.tsx")) &&
      fs.existsSync(path.join(candidate, "web-frontend", "components", "city", "CityIdentityCard.tsx")) &&
      fs.existsSync(path.join(candidate, "web-frontend", "components", "city", "CityOverviewSection.tsx")) &&
      fs.existsSync(path.join(candidate, "web-frontend", "pages", "MePage.tsx"))
    ) {
      return candidate;
    }
  }

  throw new Error("Unable to resolve repo root for settlement lane frontend continuity contract");
}

function read(repoRoot: string, relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function mustContain(text: string, needle: string, message: string): void {
  assert.ok(text.includes(needle), message);
}

test("[contract] settlement lane frontend continuity surfaces consume canonical lane payload", () => {
  const repoRoot = resolveRepoRoot();

  const mePage = read(repoRoot, "web-frontend/pages/MePage.tsx");
  const corePanel = read(repoRoot, "web-frontend/components/city/CityCorePanel.tsx");
  const identityCard = read(repoRoot, "web-frontend/components/city/CityIdentityCard.tsx");
  const overview = read(repoRoot, "web-frontend/components/city/CityOverviewSection.tsx");

  mustContain(mePage, "city.settlementLaneProfile.label", "MePage header chip should still show founded settlement lane label");
  mustContain(mePage, "city.settlementLaneProfile.posture", "MePage header chip should still show founded settlement lane posture");
  mustContain(mePage, "responseFocus.recommendedOpening", "MePage header chip should still show founded settlement lane recommended opening");

  mustContain(corePanel, "choice.preview.passivePerTick", "CityCorePanel setup preview should still render passive per-tick lane data");
  mustContain(corePanel, "choice.preview.pressureFloor", "CityCorePanel setup preview should still render lane pressure floor");
  mustContain(corePanel, "choice.responseFocus.recommendedOpening", "CityCorePanel should still render setup recommended opening");
  mustContain(corePanel, "choice.strengths", "CityCorePanel should still render setup strengths");
  mustContain(corePanel, "choice.liabilities", "CityCorePanel should still render setup tradeoffs");

  mustContain(identityCard, "city.productionBreakdown.settlementLane", "CityIdentityCard banner should still render lane passive breakdown");
  mustContain(identityCard, "city.settlementLaneReceipt.title", "CityIdentityCard should still show founding receipt title");
  mustContain(identityCard, "city.settlementLaneReceipt.summary", "CityIdentityCard should still show founding receipt summary");
  mustContain(identityCard, "city.settlementLaneLatestReceipt.message", "CityIdentityCard should still show latest lane receipt message");
  mustContain(identityCard, "city.settlementLaneProfile.responseFocus.recommendedOpening", "CityIdentityCard should still show lane recommended opening");
  mustContain(identityCard, "city.settlementLaneProfile.responseFocus.advisoryTone", "CityIdentityCard should still show lane advisory tone");

  mustContain(overview, "city.settlementLaneProfile.strengths", "CityOverviewSection should still render lane strengths");
  mustContain(overview, "city.settlementLaneProfile.liabilities", "CityOverviewSection should still render lane liabilities");
  mustContain(overview, "city.settlementLaneProfile.responseFocus.preferredActionLanes", "CityOverviewSection should still render preferred action lanes");
  mustContain(overview, "city.productionBreakdown.settlementLane", "CityOverviewSection should still render lane production breakdown");
  mustContain(overview, "city.settlementLaneLatestReceipt", "CityOverviewSection should still render latest lane receipt");
});
