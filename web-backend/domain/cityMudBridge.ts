//web-backend/domain/cityMudBridge.ts

import type { Resources } from "../gameState";
import {
  deriveCityMudConsumers,
  deriveVendorSupportPolicy,
  summarizeCityMudBridge,
} from "./cityMudBridgeSummary";
import {
  ALL_CITY_MUD_VENDOR_LANES,
  ALL_CITY_MUD_VENDOR_PRESET_KEYS,
  deriveVendorLanePolicy,
  deriveVendorPresetRecommendation,
  describeVendorLaneSelection,
  getVendorPreset,
  isCityMudVendorLane,
  isCityMudVendorPresetKey,
  matchesVendorLaneSelection,
  normalizeVendorLaneSelection,
  normalizeVendorPresetKey,
} from "./cityMudBridgeVendorPolicy";

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
  ALL_CITY_MUD_VENDOR_LANES,
  ALL_CITY_MUD_VENDOR_PRESET_KEYS,
  deriveCityMudConsumers,
  deriveVendorLanePolicy,
  deriveVendorPresetRecommendation,
  deriveVendorSupportPolicy,
  describeVendorLaneSelection,
  getVendorPreset,
  isCityMudVendorLane,
  isCityMudVendorPresetKey,
  matchesVendorLaneSelection,
  normalizeVendorLaneSelection,
  normalizeVendorPresetKey,
  summarizeCityMudBridge,
};

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
