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

export type CityMudConsumerState = "abundant" | "stable" | "pressured" | "restricted";

export interface CityMudConsumerEffect {
  key: "vendor_supply" | "mission_board" | "civic_services";
  label: string;
  state: CityMudConsumerState;
  severity: number;
  headline: string;
  detail: string;
  recommendedAction: string;
}

export interface CityMudConsumerSummary {
  vendorSupply: CityMudConsumerEffect;
  missionBoard: CityMudConsumerEffect;
  civicServices: CityMudConsumerEffect;
  advisories: string[];
}

export interface CityMudVendorSupportPolicy {
  state: CityMudConsumerState;
  stockPosture: "expand" | "maintain" | "throttle" | "restrict";
  pricePosture: "discount" | "baseline" | "caution" | "surge_guard";
  cadencePosture: "accelerate" | "normal" | "slow" | "triage";
  recommendedStockMultiplier: number;
  recommendedPriceMinMultiplier: number;
  recommendedPriceMaxMultiplier: number;
  recommendedRestockCadenceMultiplier: number;
  headline: string;
  detail: string;
  recommendedAction: string;
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

function buildConsumerEffect(
  key: CityMudConsumerEffect["key"],
  label: string,
  state: CityMudConsumerState,
  severity: number,
  headline: string,
  detail: string,
  recommendedAction: string,
): CityMudConsumerEffect {
  return {
    key,
    label,
    state,
    severity: clamp(severity, 0, 100),
    headline,
    detail,
    recommendedAction,
  };
}

export function deriveCityMudConsumers(summary: CityMudBridgeSummary): CityMudConsumerSummary {
  const topHook = summary.hooks[0] ?? null;

  let vendorSupply: CityMudConsumerEffect;
  if (summary.supportCapacity >= 70 && summary.bridgeBand === "open") {
    vendorSupply = buildConsumerEffect(
      "vendor_supply",
      "Vendor supply",
      "abundant",
      Math.max(0, 100 - summary.supportCapacity),
      "Vendor lanes can lean on city surplus.",
      `Exportable surplus is healthy (${summary.supportCapacity}/100 support capacity), so restocks and civic support can draw from the city without chewing through emergency reserves.`,
      "Safe to let vendors and routine civic support consume modest city surplus.",
    );
  } else if (summary.supportCapacity >= 50 && summary.bridgeBand === "open") {
    vendorSupply = buildConsumerEffect(
      "vendor_supply",
      "Vendor supply",
      "stable",
      45,
      "Vendor lanes are workable but not free candy.",
      "There is enough surplus to support some outward flow, but world consumers should avoid assuming infinite abundance.",
      "Prefer measured restock support instead of aggressive surplus spending.",
    );
  } else if (summary.supportCapacity >= 30 && summary.bridgeBand !== "restricted") {
    vendorSupply = buildConsumerEffect(
      "vendor_supply",
      "Vendor supply",
      "pressured",
      Math.max(55, summary.bridgeBand === "strained" ? 68 : 58),
      "Vendor support is under pressure.",
      "City exports exist, but logistics and civic load are competing with world-facing restock demand.",
      "Throttle restocks and favor essential stock before comfort goods.",
    );
  } else {
    vendorSupply = buildConsumerEffect(
      "vendor_supply",
      "Vendor supply",
      "restricted",
      88,
      "Vendor support should assume scarcity.",
      "City reserves are too stressed for broad outward support; routine restocks should not count on surplus lanes.",
      "Treat city surplus as emergency-only until support capacity recovers.",
    );
  }

  let missionBoard: CityMudConsumerEffect;
  if (summary.frontierPressure >= 60 || summary.bridgeBand === "restricted") {
    missionBoard = buildConsumerEffect(
      "mission_board",
      "Mission board",
      "restricted",
      Math.max(summary.frontierPressure, 75),
      "Frontier operations are crowding mission support.",
      "Field commitments, route danger, or defensive posture are soaking up city logistics, so mission postings should expect harsher support conditions.",
      "Bias mission generation toward escort, defense, recovery, and scarce-support contracts.",
    );
  } else if (summary.frontierPressure >= 35 || summary.logisticsPressure >= 45 || summary.bridgeBand === "strained") {
    missionBoard = buildConsumerEffect(
      "mission_board",
      "Mission board",
      "pressured",
      Math.max(summary.frontierPressure, summary.logisticsPressure, summary.bridgeBand === "strained" ? 52 : 0),
      "Mission support is available with caveats.",
      "The city can still back outward missions, but only selectively; noisy logistics, civic caution, or field traffic are eating margin.",
      "Prefer moderate missions and surface warnings about transit risk or support drag.",
    );
  } else {
    missionBoard = buildConsumerEffect(
      "mission_board",
      "Mission board",
      "stable",
      28,
      "Mission support lanes are mostly open.",
      "Field operations are not currently overwhelming the city, so mission boards can behave like normal instead of permanent triage mode.",
      "Keep mission support baseline and reserve special penalties for real threat spikes.",
    );
  }

  let civicServices: CityMudConsumerEffect;
  if (summary.logisticsPressure >= 65 || summary.stabilityPressure >= 65 || summary.bridgeBand === "restricted") {
    civicServices = buildConsumerEffect(
      "civic_services",
      "Civic services",
      "restricted",
      Math.max(summary.logisticsPressure, summary.stabilityPressure, summary.bridgeBand === "restricted" ? 75 : 0),
      "Permits and civic throughput are choking.",
      "Public-service drag and civic strain are strong enough that routine services should feel slow, expensive, or both.",
      "Escalate permit friction, queue warnings, and support-delay messaging.",
    );
  } else if (summary.logisticsPressure >= 40 || summary.stabilityPressure >= 40 || summary.bridgeBand === "strained") {
    civicServices = buildConsumerEffect(
      "civic_services",
      "Civic services",
      "pressured",
      Math.max(summary.logisticsPressure, summary.stabilityPressure, summary.bridgeBand === "strained" ? 50 : 0),
      "Civic services are feeling the squeeze.",
      "Queues, caution, and city stress are noticeable enough that outward systems should surface some public-service drag instead of pretending the bureaucracy is made of elves.",
      "Show visible civic friction, but keep routine actions viable.",
    );
  } else {
    civicServices = buildConsumerEffect(
      "civic_services",
      "Civic services",
      "stable",
      22,
      "Civic services can stay mostly invisible.",
      "Public lanes are coping fine, so world-facing systems do not need to dramatize permits or queue pain right now.",
      "Keep civic drag lightweight unless pressure rises.",
    );
  }

  const advisories = [
    vendorSupply.headline,
    missionBoard.headline,
    civicServices.headline,
    topHook ? `${topHook.label}: ${topHook.detail}` : null,
  ].filter((value): value is string => Boolean(value));

  return {
    vendorSupply,
    missionBoard,
    civicServices,
    advisories: advisories.slice(0, 4),
  };
}


export function deriveVendorSupportPolicy(
  summary: CityMudBridgeSummary,
  consumers: CityMudConsumerSummary,
): CityMudVendorSupportPolicy {
  const state = consumers.vendorSupply.state;

  if (state === "abundant") {
    return {
      state,
      stockPosture: "expand",
      pricePosture: "discount",
      cadencePosture: "accelerate",
      recommendedStockMultiplier: 1.2,
      recommendedPriceMinMultiplier: 0.9,
      recommendedPriceMaxMultiplier: 1.15,
      recommendedRestockCadenceMultiplier: 0.85,
      headline: "Vendor lanes can safely lean into surplus.",
      detail: `Bridge posture is ${summary.bridgeBand} with ${summary.supportCapacity}/100 support capacity, so vendors can be a little generous without chewing through emergency reserves.`,
      recommendedAction: "Allow broader restocks, slightly softer prices, and faster cadence for staple stock.",
    };
  }

  if (state === "stable") {
    return {
      state,
      stockPosture: "maintain",
      pricePosture: "baseline",
      cadencePosture: "normal",
      recommendedStockMultiplier: 1,
      recommendedPriceMinMultiplier: 0.95,
      recommendedPriceMaxMultiplier: 1.25,
      recommendedRestockCadenceMultiplier: 1,
      headline: "Vendor support is steady but not magical.",
      detail: "The city can support routine vendor flow, but downstream systems should avoid assuming endless abundance.",
      recommendedAction: "Keep baseline stock windows and ordinary restock cadence.",
    };
  }

  if (state === "pressured") {
    return {
      state,
      stockPosture: "throttle",
      pricePosture: "caution",
      cadencePosture: "slow",
      recommendedStockMultiplier: 0.85,
      recommendedPriceMinMultiplier: 1.0,
      recommendedPriceMaxMultiplier: 1.4,
      recommendedRestockCadenceMultiplier: 1.2,
      headline: "Vendor lanes should favor essentials over comfort.",
      detail: `The bridge is ${summary.bridgeBand}, so vendor support should acknowledge visible logistics drag instead of pretending the shelves refill by prayer alone.`,
      recommendedAction: "Throttle non-essential stock, keep staples viable, and warn that surplus lanes are under pressure.",
    };
  }

  return {
    state,
    stockPosture: "restrict",
    pricePosture: "surge_guard",
    cadencePosture: "triage",
    recommendedStockMultiplier: 0.65,
    recommendedPriceMinMultiplier: 1.05,
    recommendedPriceMaxMultiplier: 1.6,
    recommendedRestockCadenceMultiplier: 1.4,
    headline: "Vendor support should assume scarcity and triage.",
    detail: "City reserves and outward support lanes are stressed enough that routine vendor behavior should narrow toward essentials and emergency stock.",
    recommendedAction: "Restrict luxury flow, protect staple inventory, and let restocks recover before reopening broader support.",
  };
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
    100,
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
  } else if (supportCapacity < 60 || logisticsPressure >= 45 || frontierPressure >= 35 || stabilityPressure >= 35) {
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
