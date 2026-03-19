//web-backend/domain/cityMudBridge.ts

import type { Resources } from "../gameState";
import {
  deriveCityMudConsumers,
  deriveVendorSupportPolicy,
  summarizeCityMudBridge,
} from "./cityMudBridgeSummary";

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
  policyMode?: "bridge_only" | "consequence_aware";
  responsePhase?: CityMudVendorResponsePhase | null;
  laneBias?: CityMudVendorLaneBias | null;
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
  policyMode?: "bridge_only" | "consequence_aware";
  responsePhase?: CityMudVendorResponsePhase | null;
  laneBias?: CityMudVendorLaneBias | null;
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
  const response = input.responsePhase && input.responsePhase !== "quiet"
    ? ` response ${input.responsePhase}`
    : input.policyMode === "consequence_aware"
      ? " response active"
      : "";
  const laneBias = input.laneBias && input.laneBias !== "none" ? ` lane-bias ${input.laneBias}` : "";
  return `${verb} guarded vendor runtime for ${input.selectionLabel}${preset}; ${touched}; bridge ${input.bridgeBand}, vendor ${input.vendorState}${response ? `,${response.trim()}` : ""}${laneBias ? `,${laneBias.trim()}` : ""}.${softened || blocked ? ` Summary:${softened}${blocked}.` : ""}`;
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

function clampVendorInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampVendorNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export {
  deriveCityMudConsumers,
  deriveVendorSupportPolicy,
  summarizeCityMudBridge,
};

export function matchesVendorLaneSelection(policy: Pick<CityMudVendorLanePolicy, "lane"> | null | undefined, lanes: CityMudVendorLane[]): boolean {
  if (lanes.length === 0) return true;
  if (!policy) return false;
  return lanes.includes(policy.lane);
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
