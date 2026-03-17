//web-backend/domain/cityMudBridge.ts

import type { PlayerState, Resources } from "../gameState";
import { getCityProductionPerTick } from "./city";
import { summarizePublicInfrastructure } from "./publicInfrastructure";

export type CityMudBridgeBand = "open" | "strained" | "restricted";
export type CityMudBridgePosture = "supportive" | "cautious" | "defensive";
export type CityMudBridgeHookKey =
  | "vendor_supply"
  | "caravan_risk"
  | "mission_support"
  | "recruitment_pressure"
  | "public_service_drag";

export interface CityMudBridgeHook {
  key: CityMudBridgeHookKey;
  label: string;
  score: number;
  direction: "up" | "down" | "neutral";
  detail: string;
  mudEffect: string;
}

export interface CityMudBridgeSummary {
  snapshotAt: string;
  bridgeBand: CityMudBridgeBand;
  recommendedPosture: CityMudBridgePosture;
  supportCapacity: number;
  logisticsPressure: number;
  frontierPressure: number;
  stabilityPressure: number;
  exportableResources: Partial<Resources>;
  hooks: CityMudBridgeHook[];
  tags: string[];
  note: string;
}

const RESOURCE_KEYS: Array<keyof Resources> = ["food", "materials", "wealth", "mana", "knowledge", "unity"];
const RESOURCE_BUFFERS: Resources = {
  food: 120,
  materials: 90,
  wealth: 90,
  mana: 45,
  knowledge: 36,
  unity: 24,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function computeExportableResources(ps: PlayerState): Partial<Resources> {
  const production = getCityProductionPerTick(ps.city);
  const exportable: Partial<Resources> = {};
  for (const key of RESOURCE_KEYS) {
    const current = Number(ps.resources[key] ?? 0);
    const buffer = RESOURCE_BUFFERS[key];
    const reserveFree = Math.max(0, current - buffer);
    const productionCap = Math.max(0, Math.round(Number(production[key] ?? 0) * 4));
    const safeAmount = Math.max(0, Math.min(reserveFree, productionCap > 0 ? productionCap : reserveFree > 0 ? Math.ceil(reserveFree * 0.2) : 0));
    if (safeAmount > 0) {
      exportable[key] = safeAmount;
    }
  }
  return exportable;
}

function sumExportableResources(exportable: Partial<Resources>): number {
  return RESOURCE_KEYS.reduce((sum, key) => sum + Number(exportable[key] ?? 0), 0);
}

export function summarizeCityMudBridge(ps: PlayerState): CityMudBridgeSummary {
  const infraSummary = summarizePublicInfrastructure(ps);
  const exportableResources = computeExportableResources(ps);
  const exportableTotal = sumExportableResources(exportableResources);
  const activeWorkshopJobs = (ps.workshopJobs ?? []).filter((job) => !job.completed).length;
  const frontierThreat = Math.max(0, ...(ps.regionWar ?? []).map((region) => Number(region.threat ?? 0)));
  const activeMissions = Math.max(0, Number(ps.activeMissions?.length ?? 0));
  const deployedArmies = (ps.armies ?? []).filter((army) => army.status === "on_mission").length;
  const deployedHeroes = (ps.heroes ?? []).filter((hero) => hero.status === "on_mission").length;
  const logisticsPressure = clamp(infraSummary.pressureScore * 0.45 + activeWorkshopJobs * 7 + (ps.activeResearch ? 8 : 0), 0, 100);
  const frontierPressure = clamp(frontierThreat * 0.6 + activeMissions * 6 + deployedArmies * 5, 0, 100);
  const stabilityPressure = clamp(Number(ps.cityStress?.total ?? 0) * 0.85 + (ps.policies?.conscription ? 6 : 0), 0, 100);
  const supportCapacity = clamp(
    exportableTotal * 1.25 + Number(ps.city.stats?.infrastructure ?? 0) * 0.35 + Number(ps.city.stats?.prosperity ?? 0) * 0.2 + Number(ps.city.stats?.security ?? 0) * 0.15 - logisticsPressure * 0.35 - frontierPressure * 0.25 - stabilityPressure * 0.25,
    0,
    100
  );

  const hooks = [
    {
      key: "vendor_supply",
      label: "Vendor supply",
      score: clamp(exportableTotal * 1.5, 0, 100),
      direction: exportableTotal > 0 ? "up" : "neutral",
      detail:
        exportableTotal > 0
          ? `City surplus can safely export ${exportableTotal} total resource units into world-facing services.`
          : "City reserves are tight; there is no clean surplus to export yet.",
      mudEffect: exportableTotal > 0 ? "Vendor restocks and civic support can draw from city surplus." : "Vendors should rely on local/world stock, not city surplus.",
    },
    {
      key: "caravan_risk",
      label: "Caravan risk",
      score: frontierPressure,
      direction: frontierPressure >= 45 ? "down" : "neutral",
      detail:
        frontierPressure >= 45
          ? `Frontier threat and mission traffic are stressing routes at ${frontierPressure}/100.`
          : "Transit routes are relatively calm right now.",
      mudEffect: frontierPressure >= 45 ? "Escort cost, transit delay, and shipment risk should trend upward." : "Transit penalties can stay light.",
    },
    {
      key: "mission_support",
      label: "Mission support",
      score: clamp(activeMissions * 10 + deployedArmies * 8 + deployedHeroes * 5, 0, 100),
      direction: activeMissions + deployedArmies + deployedHeroes > 0 ? "down" : "neutral",
      detail:
        activeMissions + deployedArmies + deployedHeroes > 0
          ? `${activeMissions} active missions, ${deployedArmies} armies out, and ${deployedHeroes} deployed heroes are pulling logistics toward the frontier.`
          : "No major active mission drain is competing for city output.",
      mudEffect: activeMissions + deployedArmies + deployedHeroes > 0 ? "World support should prioritize field commitments before comfort supply." : "No special mission-priority drain is needed.",
    },
    {
      key: "recruitment_pressure",
      label: "Recruitment pressure",
      score: clamp(Math.max(0, ps.heroes.length - 4) * 6 + Math.max(0, ps.armies.length - 2) * 7 + (ps.policies?.conscription ? 12 : 0), 0, 100),
      direction: ps.heroes.length + ps.armies.length >= 8 || ps.policies?.conscription ? "down" : "neutral",
      detail:
        ps.heroes.length + ps.armies.length >= 8 || ps.policies?.conscription
          ? `Hero/army upkeep and policy load are increasing civic staffing pressure.`
          : "Recruitment pressure is presently manageable.",
      mudEffect: ps.heroes.length + ps.armies.length >= 8 || ps.policies?.conscription ? "Training, militia support, and service staffing should drift toward caution." : "No special staffing penalties are needed.",
    },
    {
      key: "public_service_drag",
      label: "Public service drag",
      score: logisticsPressure,
      direction: logisticsPressure >= 40 ? "down" : "neutral",
      detail:
        logisticsPressure >= 40
          ? `Public infrastructure strain, queue backlog, and civic overhead are sitting at ${logisticsPressure}/100.`
          : "Public-service overhead is not seriously choking logistics.",
      mudEffect: logisticsPressure >= 40 ? "Town services, permits, and civic support should feel slower or pricier." : "Service drag can remain mostly invisible.",
    },
  ] satisfies CityMudBridgeHook[];

  hooks.sort((a, b) => b.score - a.score);

  const tags = hooks
    .filter((hook) => hook.score >= 40)
    .slice(0, 3)
    .map((hook) => hook.key);

  let bridgeBand: CityMudBridgeBand = "open";
  let recommendedPosture: CityMudBridgePosture = "supportive";
  if (supportCapacity < 35 || frontierPressure >= 60 || stabilityPressure >= 65) {
    bridgeBand = "restricted";
    recommendedPosture = "defensive";
  } else if (supportCapacity < 60 || logisticsPressure >= 45 || frontierPressure >= 35) {
    bridgeBand = "strained";
    recommendedPosture = "cautious";
  }

  let note = "City-to-world support lanes are healthy enough to feed MUD-facing systems.";
  if (bridgeBand === "strained") {
    note = "City-to-world support lanes are usable but pressured; world systems should expect selective drag instead of free abundance.";
  } else if (bridgeBand === "restricted") {
    note = "City-to-world support lanes are under real pressure; MUD-facing systems should favor defense, escorts, and scarce supply behavior.";
  }

  return {
    snapshotAt: new Date().toISOString(),
    bridgeBand,
    recommendedPosture,
    supportCapacity,
    logisticsPressure,
    frontierPressure,
    stabilityPressure,
    exportableResources,
    hooks,
    tags,
    note,
  };
}
