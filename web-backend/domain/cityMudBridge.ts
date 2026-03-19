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

export type CityMudVendorResponsePhase = "quiet" | "watch" | "active" | "severe";
export type CityMudVendorLaneBias = "none" | "essentials_only" | "luxury_throttle" | "arcane_caution";

export interface CityMudVendorPresetRecommendation {
  key: CityMudVendorPresetKey;
  label: string;
  laneFilters: CityMudVendorLane[];
  reason: string;
  note: string;
}

export type CityMudVendorLane = "essentials" | "comfort" | "luxury" | "arcane";
export type CityMudVendorPresetKey = "scarcity_essentials_protection" | "luxury_throttle" | "arcane_caution" | "broad_recovery";

export const ALL_CITY_MUD_VENDOR_LANES: CityMudVendorLane[] = ["essentials", "comfort", "luxury", "arcane"];
export const ALL_CITY_MUD_VENDOR_PRESET_KEYS: CityMudVendorPresetKey[] = [
  "scarcity_essentials_protection",
  "luxury_throttle",
  "arcane_caution",
  "broad_recovery",
];

export function isCityMudVendorLane(value: unknown): value is CityMudVendorLane {
  return typeof value === "string" && (ALL_CITY_MUD_VENDOR_LANES as string[]).includes(value);
}

export function normalizeVendorLaneSelection(values: unknown): CityMudVendorLane[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<CityMudVendorLane>();
  const lanes: CityMudVendorLane[] = [];
  for (const value of values) {
    if (!isCityMudVendorLane(value) || seen.has(value)) continue;
    seen.add(value);
    lanes.push(value);
  }
  return lanes;
}

export function describeVendorLaneSelection(lanes: CityMudVendorLane[]): string {
  if (lanes.length === 0) return "selected rows";
  if (lanes.length === 1) return `${lanes[0]} lane`;
  if (lanes.length === ALL_CITY_MUD_VENDOR_LANES.length) return "all lanes";
  return `${lanes.join(", ")} lanes`;
}
export function isCityMudVendorPresetKey(value: unknown): value is CityMudVendorPresetKey {
  return typeof value === "string" && (ALL_CITY_MUD_VENDOR_PRESET_KEYS as string[]).includes(value);
}

export function deriveVendorPresetRecommendation(input: {
  policyState: CityMudConsumerState;
  responsePhase?: CityMudVendorResponsePhase | null;
  laneBias?: CityMudVendorLaneBias | null;
}): CityMudVendorPresetRecommendation | null {
  const responsePhase = input.responsePhase ?? null;
  const laneBias = input.laneBias ?? null;

  let key: CityMudVendorPresetKey | null = null;
  let reason = "";
  let note = "";

  if (responsePhase === "severe" || input.policyState === "restricted" || laneBias === "essentials_only") {
    key = "scarcity_essentials_protection";
    reason = "Severe response or restricted vendor posture should protect essentials first.";
    note = "This is the safest bounded preset when runtime pressure is hot enough to squeeze shelves broadly.";
  } else if (laneBias === "luxury_throttle") {
    key = "luxury_throttle";
    reason = "Live response pressure is explicitly asking luxury lanes to absorb pain first.";
    note = "Use this when cartel/black-market heat is real but you do not need full scarcity theater across every lane.";
  } else if (laneBias === "arcane_caution") {
    key = "arcane_caution";
    reason = "Live response pressure is asking arcane lanes to stay available with measured caution.";
    note = "Use this when active pressure should slow fragile or magical inventory without pretending everything is collapsing.";
  } else if (responsePhase === "quiet" && (input.policyState === "stable" || input.policyState === "abundant")) {
    key = "broad_recovery";
    reason = "Quiet response conditions can support broad recovery instead of emergency throttling.";
    note = "This is a recovery preset, not a pressure preset; use it only when the response phase has cooled off.";
  }

  if (!key) return null;
  const preset = getVendorPreset(key);
  return {
    key: preset.key,
    label: preset.label,
    laneFilters: [...preset.laneFilters],
    reason,
    note,
  };
}

export function getVendorPreset(key: CityMudVendorPresetKey): CityMudVendorPreset {
  switch (key) {
    case "scarcity_essentials_protection":
      return {
        key,
        label: "Scarcity essentials protection",
        detail: "Protect essentials first when city support is tight, leaving comfort and luxury lanes untouched.",
        laneFilters: ["essentials"],
        recommendedAction: "Use during scarcity or civic strain to keep bread-and-bolts stock alive.",
      };
    case "luxury_throttle":
      return {
        key,
        label: "Luxury throttle",
        detail: "Throttle luxury stock first so pressure lands on optional indulgence before civic basics.",
        laneFilters: ["luxury"],
        recommendedAction: "Use when you want visible scarcity to hit non-essential stock before protected lanes.",
      };
    case "arcane_caution":
      return {
        key,
        label: "Arcane caution",
        detail: "Apply guarded pressure only to arcane lanes when mystical supply should remain viable but cautious.",
        laneFilters: ["arcane"],
        recommendedAction: "Use when mana-side supply should stay alive without being treated like staple goods.",
      };
    case "broad_recovery":
    default:
      return {
        key: "broad_recovery",
        label: "Broad recovery",
        detail: "Apply guarded recovery posture across all vendor lanes during stabilization or post-crisis easing.",
        laneFilters: [...ALL_CITY_MUD_VENDOR_LANES],
        recommendedAction: "Use when the city is recovering and you want a broad, audited policy pass.",
      };
  }
}

export function normalizeVendorPresetKey(value: unknown): CityMudVendorPresetKey | null {
  return isCityMudVendorPresetKey(value) ? value : null;
}

export interface CityMudVendorLaneProfile {
  lane: CityMudVendorLane;
  label: string;
  detail: string;
  recommendedAction: string;
}

export interface CityMudVendorPreset {
  key: CityMudVendorPresetKey;
  label: string;
  detail: string;
  laneFilters: CityMudVendorLane[];
  recommendedAction: string;
}

export interface CityMudVendorLanePolicy extends CityMudVendorSupportPolicy {
  lane: CityMudVendorLane;
  laneLabel: string;
  laneDetail: string;
}


export interface CityMudVendorScenarioLogSampleItem {
  vendorItemId: number;
  itemId: string;
  itemName: string | null;
  lane: CityMudVendorLane;
  runtimeState: "surplus" | "normal" | "tight" | "scarce";
  allowed: boolean;
  applied: boolean;
  warnings: string[];
}

export interface CityMudVendorScenarioLogEntry {
  at: string;
  actor: "admin_ui";
  action: "preview" | "apply";
  vendorId: string;
  selectionLabel: string;
  laneFilters: CityMudVendorLane[];
  presetKey: CityMudVendorPresetKey | null;
  bridgeBand: CityMudBridgeBand;
  vendorState: CityMudConsumerState;
  matchedCount: number;
  appliedCount: number;
  softenedCount: number;
  blockedCount: number;
  warningCount: number;
  note: string;
  detail?: {
    selectionKind: "vendor_item_ids" | "lane_filters" | "preset";
    topWarnings?: string[];
    sampleItems?: CityMudVendorScenarioLogSampleItem[];
  };
}

export function buildVendorScenarioLogNote(input: {
  action: "preview" | "apply";
  selectionLabel: string;
  presetKey: CityMudVendorPresetKey | null;
  bridgeBand: CityMudBridgeBand;
  vendorState: CityMudConsumerState;
  matchedCount: number;
  appliedCount: number;
  softenedCount: number;
  blockedCount: number;
}): string {
  const verb = input.action === "apply" ? "Applied" : "Previewed";
  const preset = input.presetKey ? ` via preset ${input.presetKey}` : "";
  const touched = input.action === "apply" ? `${input.appliedCount}/${input.matchedCount} row(s)` : `${input.matchedCount} row(s)`;
  const softened = input.softenedCount > 0 ? ` guardrails softened ${input.softenedCount}` : "";
  const blocked = input.blockedCount > 0 ? ` blocked ${input.blockedCount}` : "";
  return `${verb} guarded vendor runtime for ${input.selectionLabel}${preset}; ${touched}; bridge ${input.bridgeBand}, vendor ${input.vendorState}.${softened || blocked ? ` Summary:${softened}${blocked}.` : ""}`;
}
export interface CityMudVendorEconomyRecommendation {
  stockMax: number;
  restockEverySec: number;
  restockAmount: number;
  priceMinMult: number;
  priceMaxMult: number;
  restockPerHour: number;
  headline: string;
  detail: string;
}


export interface CityMudVendorGuardrailApplication {
  allowed: boolean;
  autoApplyEligible: boolean;
  stockMax: number;
  restockEverySec: number;
  restockAmount: number;
  priceMinMult: number;
  priceMaxMult: number;
  restockPerHour: number;
  warnings: string[];
  reason: string;
  headline: string;
  detail: string;
}
export interface CityMudVendorRuntimeEffect {
  state: "surplus" | "normal" | "tight" | "scarce";
  effectiveStockMax: number;
  effectiveRestockEverySec: number;
  effectiveRestockAmount: number;
  effectivePriceMinMult: number;
  effectivePriceMaxMult: number;
  effectiveRestockPerHour: number;
  stockFillRatio: number | null;
  headline: string;
  detail: string;
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

function clampVendorInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampVendorNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
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


export function matchesVendorLaneSelection(policy: Pick<CityMudVendorLanePolicy, "lane"> | null | undefined, lanes: CityMudVendorLane[]): boolean {
  if (lanes.length === 0) return true;
  if (!policy) return false;
  return lanes.includes(policy.lane);
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



function detectVendorLane(input: { itemId?: string | null; itemName?: string | null; itemRarity?: string | null }): CityMudVendorLaneProfile {
  const id = String(input.itemId ?? "").toLowerCase();
  const name = String(input.itemName ?? "").toLowerCase();
  const rarity = String(input.itemRarity ?? "").toLowerCase();
  const haystack = `${id} ${name}`;

  const hasAny = (tokens: string[]) => tokens.some((token) => haystack.includes(token));

  if (rarity.includes("legend") || rarity.includes("epic") || rarity.includes("myth") || rarity.includes("relic") || hasAny(["luxury", "gem", "jewel", "feast", "wine", "crown", "silk"])) {
    return {
      lane: "luxury",
      label: "Luxury goods",
      detail: "Luxury and prestige inventory should feel scarcity first when the city-mud bridge is under pressure.",
      recommendedAction: "Throttle comfort and prestige stock before touching staples.",
    };
  }

  if (hasAny(["mana", "scroll", "rune", "tome", "glyph", "wand", "staff", "crystal", "focus"])) {
    return {
      lane: "arcane",
      label: "Arcane stock",
      detail: "Arcane inventory should stay viable, but it can tolerate some caution when logistics tighten.",
      recommendedAction: "Keep magical staples available, but avoid pretending ritual stock is infinite.",
    };
  }

  if (hasAny(["food", "bread", "ration", "water", "bandage", "herb", "ore", "wood", "stone", "cloth", "torch", "potion"])) {
    return {
      lane: "essentials",
      label: "Essentials",
      detail: "Staples and basic survival goods should be protected even when other lanes are throttled.",
      recommendedAction: "Favor staple stock, milder price pressure, and faster cadence recovery.",
    };
  }

  return {
    lane: "comfort",
    label: "Comfort goods",
    detail: "Comfort goods can track the baseline vendor posture without the hard priority of essentials or the fragility of luxury stock.",
    recommendedAction: "Let comfort stock follow baseline pressure unless a stronger lane bias is needed.",
  };
}

export function deriveVendorLanePolicy(
  summary: CityMudBridgeSummary,
  consumers: CityMudConsumerSummary,
  basePolicy: CityMudVendorSupportPolicy,
  input: { itemId?: string | null; itemName?: string | null; itemRarity?: string | null },
): CityMudVendorLanePolicy {
  const profile = detectVendorLane(input);
  let stock = basePolicy.recommendedStockMultiplier;
  let priceMin = basePolicy.recommendedPriceMinMultiplier;
  let priceMax = basePolicy.recommendedPriceMaxMultiplier;
  let cadence = basePolicy.recommendedRestockCadenceMultiplier;
  let headline = basePolicy.headline;
  let detail = `${basePolicy.detail} ${profile.detail}`;
  let action = `${basePolicy.recommendedAction} ${profile.recommendedAction}`;

  if (profile.lane === "essentials") {
    stock *= basePolicy.state === "restricted" ? 1.18 : 1.12;
    cadence *= basePolicy.state === "abundant" ? 0.95 : 0.9;
    priceMin *= 0.96;
    priceMax *= 0.92;
    headline = basePolicy.state === "restricted"
      ? "Essentials should be protected even under scarcity."
      : "Essentials should stay ahead of the pressure curve.";
  } else if (profile.lane === "luxury") {
    stock *= basePolicy.state === "abundant" ? 1.05 : 0.72;
    cadence *= basePolicy.state === "abundant" ? 1 : 1.2;
    priceMin *= basePolicy.state === "abundant" ? 1.02 : 1.08;
    priceMax *= basePolicy.state === "abundant" ? 1.08 : 1.18;
    headline = basePolicy.state === "abundant"
      ? "Luxury goods can ride surplus without owning it."
      : "Luxury goods should absorb scarcity before staples do.";
  } else if (profile.lane === "arcane") {
    stock *= basePolicy.state === "restricted" ? 0.88 : 0.97;
    cadence *= basePolicy.state === "abundant" ? 0.98 : 1.04;
    priceMin *= 1.01;
    priceMax *= 1.05;
    headline = "Arcane stock should stay viable with measured caution.";
  }

  stock = clampVendorNum(stock, 0.35, 1.5);
  cadence = clampVendorNum(cadence, 0.65, 1.75);
  priceMin = clampVendorNum(priceMin, 0.7, 1.4);
  priceMax = clampVendorNum(priceMax, 0.9, 2.25);
  if (priceMin > priceMax) {
    const lo = Math.min(priceMin, priceMax);
    const hi = Math.max(priceMin, priceMax);
    priceMin = lo;
    priceMax = hi;
  }

  return {
    ...basePolicy,
    lane: profile.lane,
    laneLabel: profile.label,
    laneDetail: profile.detail,
    recommendedStockMultiplier: stock,
    recommendedPriceMinMultiplier: priceMin,
    recommendedPriceMaxMultiplier: priceMax,
    recommendedRestockCadenceMultiplier: cadence,
    headline,
    detail,
    recommendedAction: action,
  };
}

export function deriveVendorEconomyRecommendation(
  base: {
    stockMax: number | null | undefined;
    restockEverySec: number | null | undefined;
    restockAmount: number | null | undefined;
    priceMinMult: number | null | undefined;
    priceMaxMult: number | null | undefined;
  },
  policy: CityMudVendorSupportPolicy,
): CityMudVendorEconomyRecommendation {
  const stockMaxBase = clampVendorInt(Number(base.stockMax ?? 50), 0, 1_000_000);
  const restockEverySecBase = clampVendorInt(Number(base.restockEverySec ?? 0), 0, 31_536_000);
  const restockAmountBase = clampVendorInt(Number(base.restockAmount ?? 0), 0, 1_000_000);
  const priceMinBase = clampVendorNum(Number(base.priceMinMult ?? 0.85), 0.05, 10);
  const priceMaxBase = clampVendorNum(Number(base.priceMaxMult ?? 1.5), 0.05, 10);

  const stockMax = clampVendorInt(stockMaxBase * policy.recommendedStockMultiplier, 0, 1_000_000);
  const restockEverySec = restockEverySecBase > 0
    ? clampVendorInt(restockEverySecBase * policy.recommendedRestockCadenceMultiplier, 0, 31_536_000)
    : 0;
  const restockAmount = restockAmountBase > 0
    ? clampVendorInt(restockAmountBase * policy.recommendedStockMultiplier, 0, 1_000_000)
    : 0;

  let priceMinMult = clampVendorNum(priceMinBase * policy.recommendedPriceMinMultiplier, 0.05, 10);
  let priceMaxMult = clampVendorNum(priceMaxBase * policy.recommendedPriceMaxMultiplier, 0.05, 10);
  if (priceMinMult > priceMaxMult) {
    const lo = Math.min(priceMinMult, priceMaxMult);
    const hi = Math.max(priceMinMult, priceMaxMult);
    priceMinMult = lo;
    priceMaxMult = hi;
  }

  const restockPerHour =
    restockEverySec > 0 && restockAmount > 0
      ? clampVendorInt(Math.ceil((restockAmount * 3600) / restockEverySec), 0, 1_000_000)
      : 0;

  return {
    stockMax,
    restockEverySec,
    restockAmount,
    priceMinMult: Number(priceMinMult.toFixed(3)),
    priceMaxMult: Number(priceMaxMult.toFixed(3)),
    restockPerHour,
    headline: policy.headline,
    detail: `${policy.detail} ${policy.recommendedAction}`.trim(),
  };
}

export function deriveVendorRuntimeEffect(
  base: {
    stock: number | null | undefined;
    stockMax: number | null | undefined;
    restockEverySec: number | null | undefined;
    restockAmount: number | null | undefined;
    priceMinMult: number | null | undefined;
    priceMaxMult: number | null | undefined;
  },
  policy: CityMudVendorSupportPolicy,
): CityMudVendorRuntimeEffect {
  const recommendation = deriveVendorEconomyRecommendation(base, policy);
  const effectiveStockMax = recommendation.stockMax;
  const effectiveRestockEverySec = recommendation.restockEverySec;
  const effectiveRestockAmount = recommendation.restockAmount;
  const effectivePriceMinMult = recommendation.priceMinMult;
  const effectivePriceMaxMult = recommendation.priceMaxMult;
  const effectiveRestockPerHour = recommendation.restockPerHour;
  const currentStock = base.stock == null ? null : clampVendorInt(Number(base.stock), 0, 1_000_000);
  const stockFillRatio = effectiveStockMax > 0 && currentStock != null
    ? Number((currentStock / effectiveStockMax).toFixed(3))
    : null;

  let state: CityMudVendorRuntimeEffect["state"] = "normal";
  if (policy.state === "abundant") state = "surplus";
  else if (policy.state === "stable") state = "normal";
  else if (policy.state === "pressured") state = "tight";
  else state = "scarce";

  if (stockFillRatio != null) {
    if (stockFillRatio < 0.2) {
      state = state === "surplus" ? "normal" : state === "normal" ? "tight" : "scarce";
    } else if (stockFillRatio > 0.95 && state === "tight") {
      state = "normal";
    }
  }

  let headline = "Vendor runtime can stay close to baseline.";
  let detail = "Live bridge policy is not currently pushing strong vendor runtime distortions.";
  if (state === "surplus") {
    headline = "Vendor runtime can flow a little more generously.";
    detail = `Live bridge posture is ${policy.state}, so vendor stock and cadence can run slightly hotter than baseline without eating emergency reserves.`;
  } else if (state === "tight") {
    headline = "Vendor runtime should show visible pressure.";
    detail = `Live bridge posture is ${policy.state}, so runtime stock windows and refill cadence should feel a bit tighter than baseline instead of pretending the shelves refill by prayer.`;
  } else if (state === "scarce") {
    headline = "Vendor runtime should behave like scarcity, not abundance.";
    detail = `Live bridge posture is ${policy.state}, so runtime stock, cadence, and price windows should be treated as defensive/triage lanes.`;
  }
  if (stockFillRatio != null) {
    detail += ` Current stock fill is ${(stockFillRatio * 100).toFixed(0)}% of the live effective cap.`;
  }

  return {
    state,
    effectiveStockMax,
    effectiveRestockEverySec,
    effectiveRestockAmount,
    effectivePriceMinMult,
    effectivePriceMaxMult,
    effectiveRestockPerHour,
    stockFillRatio,
    headline,
    detail,
  };
}


export function deriveVendorGuardrailApplication(
  base: {
    stockMax: number | null | undefined;
    restockEverySec: number | null | undefined;
    restockAmount: number | null | undefined;
    priceMinMult: number | null | undefined;
    priceMaxMult: number | null | undefined;
  },
  runtime: CityMudVendorRuntimeEffect,
): CityMudVendorGuardrailApplication {
  const currentStockMax = clampVendorInt(Number(base.stockMax ?? 50), 0, 1_000_000);
  const currentRestockEverySec = clampVendorInt(Number(base.restockEverySec ?? 0), 0, 31_536_000);
  const currentRestockAmount = clampVendorInt(Number(base.restockAmount ?? 0), 0, 1_000_000);
  const currentPriceMin = clampVendorNum(Number(base.priceMinMult ?? 0.85), 0.05, 10);
  const currentPriceMax = clampVendorNum(Number(base.priceMaxMult ?? 1.5), 0.05, 10);

  const warnings: string[] = [];

  const maxStockDelta = Math.max(10, Math.round(Math.max(currentStockMax, runtime.effectiveStockMax, 20) * 0.35));
  let stockMax = runtime.effectiveStockMax;
  if (Math.abs(stockMax - currentStockMax) > maxStockDelta) {
    stockMax = currentStockMax + Math.sign(stockMax - currentStockMax) * maxStockDelta;
    warnings.push('Stock cap change was softened by guardrails.');
  }
  stockMax = clampVendorInt(stockMax, 0, 1_000_000);

  const cadenceFloor = currentRestockEverySec > 0 ? Math.max(60, Math.floor(currentRestockEverySec * 0.6)) : 0;
  const cadenceCeil = currentRestockEverySec > 0 ? Math.min(31_536_000, Math.ceil(currentRestockEverySec * 1.6)) : runtime.effectiveRestockEverySec;
  let restockEverySec = runtime.effectiveRestockEverySec;
  if (currentRestockEverySec > 0) {
    if (restockEverySec < cadenceFloor) {
      restockEverySec = cadenceFloor;
      warnings.push('Restock cadence acceleration was softened by guardrails.');
    }
    if (restockEverySec > cadenceCeil) {
      restockEverySec = cadenceCeil;
      warnings.push('Restock cadence slowdown was softened by guardrails.');
    }
  }
  restockEverySec = clampVendorInt(restockEverySec, 0, 31_536_000);

  const amountDeltaCap = Math.max(2, Math.round(Math.max(currentRestockAmount, runtime.effectiveRestockAmount, 4) * 0.4));
  let restockAmount = runtime.effectiveRestockAmount;
  if (Math.abs(restockAmount - currentRestockAmount) > amountDeltaCap) {
    restockAmount = currentRestockAmount + Math.sign(restockAmount - currentRestockAmount) * amountDeltaCap;
    warnings.push('Restock amount change was softened by guardrails.');
  }
  restockAmount = clampVendorInt(restockAmount, 0, 1_000_000);

  const priceStepCap = 0.2;
  let priceMinMult = runtime.effectivePriceMinMult;
  let priceMaxMult = runtime.effectivePriceMaxMult;
  if (Math.abs(priceMinMult - currentPriceMin) > priceStepCap) {
    priceMinMult = currentPriceMin + Math.sign(priceMinMult - currentPriceMin) * priceStepCap;
    warnings.push('Minimum price multiplier change was softened by guardrails.');
  }
  if (Math.abs(priceMaxMult - currentPriceMax) > priceStepCap) {
    priceMaxMult = currentPriceMax + Math.sign(priceMaxMult - currentPriceMax) * priceStepCap;
    warnings.push('Maximum price multiplier change was softened by guardrails.');
  }
  priceMinMult = clampVendorNum(Number(priceMinMult.toFixed(3)), 0.05, 10);
  priceMaxMult = clampVendorNum(Number(priceMaxMult.toFixed(3)), 0.05, 10);
  if (priceMinMult > priceMaxMult) {
    const lo = Math.min(priceMinMult, priceMaxMult);
    const hi = Math.max(priceMinMult, priceMaxMult);
    priceMinMult = lo;
    priceMaxMult = hi;
  }

  const restockPerHour =
    restockEverySec > 0 && restockAmount > 0
      ? clampVendorInt(Math.ceil((restockAmount * 3600) / restockEverySec), 0, 1_000_000)
      : 0;

  const autoApplyEligible = warnings.length === 0 && runtime.state !== 'scarce';
  const allowed = runtime.state !== 'scarce' || warnings.length > 0;
  const reason = warnings.length > 0
    ? runtime.state === 'scarce'
      ? 'Scarce runtime posture requires a guarded operator apply, and guardrails softened the change into a safe one-step window.'
      : 'Runtime preview was larger than the safe one-step window, so guardrails softened the change.'
    : runtime.state === 'scarce'
      ? 'Scarce runtime posture requires a guarded operator apply instead of blind automation.'
      : 'Runtime preview is inside the safe one-step window.';

  return {
    allowed,
    autoApplyEligible,
    stockMax,
    restockEverySec,
    restockAmount,
    priceMinMult,
    priceMaxMult,
    restockPerHour,
    warnings,
    reason,
    headline: autoApplyEligible
      ? 'Bridge runtime can be auto-staged safely.'
      : runtime.state === 'scarce'
        ? 'Bridge runtime needs operator guardrails.'
        : 'Bridge runtime can be staged, but guardrails softened it.',
    detail: `${reason}${warnings.length > 0 ? ` Warnings: ${warnings.join(' ')}` : ''}`.trim(),
  };
}
