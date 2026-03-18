//web-backend/domain/worldConsequenceConsumers.ts

import type { PlayerState } from "../gameState";
import type { CityMudVendorSupportPolicy } from "./cityMudBridge";
import type { MissionOfferSupportGuidance } from "./missions";
import type { WorldConsequenceActionsView } from "./worldConsequenceActions";
import { deriveWorldConsequenceActions } from "./worldConsequenceActions";
import type { WorldConsequenceHooksView } from "./worldConsequenceHooks";
import { deriveWorldConsequenceHooks } from "./worldConsequenceHooks";
import { deriveEconomyCartelResponseState } from "./economyCartelResponse";
import type { WorldConsequenceState } from "./worldConsequences";

export type WorldConsequencePressureTier = "quiet" | "watch" | "active" | "severe";

export interface WorldConsequenceConsumerSummary {
  pressureTier: WorldConsequencePressureTier;
  headline: string;
  note: string;
  sourceRegionId: string | null;
  shouldNudgeRuntime: boolean;
}

export interface WorldConsequenceVendorConsumer {
  stockMultiplierDelta: number;
  priceMinDelta: number;
  priceMaxDelta: number;
  cadenceDelta: number;
  laneBias: "none" | "essentials_only" | "luxury_throttle" | "arcane_caution";
  note: string;
}

export interface WorldConsequenceMissionConsumer {
  supportBias: "none" | "pressured" | "restricted";
  severityBoost: number;
  note: string;
}

export interface WorldConsequenceAdminConsumer {
  auditWatch: boolean;
  cartelWatch: boolean;
  note: string;
}

export interface WorldConsequenceConsumersView {
  summary: WorldConsequenceConsumerSummary;
  vendor: WorldConsequenceVendorConsumer;
  missions: WorldConsequenceMissionConsumer;
  admin: WorldConsequenceAdminConsumer;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function deriveWorldConsequenceConsumers(
  ps: PlayerState,
  state?: WorldConsequenceState | null,
  hooks?: WorldConsequenceHooksView | null,
  actions?: WorldConsequenceActionsView | null,
): WorldConsequenceConsumersView {
  const safeState = state ?? ps.worldConsequenceState;
  const safeHooks = hooks ?? deriveWorldConsequenceHooks(ps, safeState);
  const safeActions = actions ?? deriveWorldConsequenceActions(ps, safeState, safeHooks);
  const response = deriveEconomyCartelResponseState(ps, safeState);

  const affectedRegionCount = Number(safeState?.summary?.affectedRegionIds?.length ?? 0);
  const hotspotCount = Number(safeHooks.hotspots?.length ?? 0);
  const highActionCount =
    (safeActions.playerActions ?? []).filter((a) => a.priority === "high" || a.priority === "critical").length
    + (safeActions.adminActions ?? []).filter((a) => a.priority === "high" || a.priority === "critical").length
    + (safeActions.motherBrainActions ?? []).filter((a) => a.priority === "high" || a.priority === "critical").length;

  const pressureTier: WorldConsequencePressureTier = response.summary.responsePhase;

  const admin: WorldConsequenceAdminConsumer = {
    auditWatch: pressureTier !== "quiet" || affectedRegionCount > 0 || hotspotCount > 0,
    cartelWatch: response.cartel.tier === "active" || response.cartel.tier === "crackdown" || response.blackMarket.state === "surging",
    note:
      pressureTier === "quiet"
        ? "No admin consequence intervention is recommended yet."
        : pressureTier === "severe"
        ? "Admin surfaces should highlight response hotspots, vendor tightening, and cartel escalation immediately."
        : "Admin surfaces should keep economy/cartel response visible and auditable while it remains active.",
  };

  return {
    summary: {
      pressureTier,
      headline: response.summary.headline,
      note: response.summary.note,
      sourceRegionId: response.summary.sourceRegionId,
      shouldNudgeRuntime: response.summary.shouldNudgeRuntime,
    },
    vendor: {
      stockMultiplierDelta: response.vendors.stockMultiplierDelta,
      priceMinDelta: response.vendors.priceMinDelta,
      priceMaxDelta: response.vendors.priceMaxDelta,
      cadenceDelta: response.vendors.cadenceDelta,
      laneBias: response.vendors.laneBias,
      note: response.vendors.note,
    },
    missions: {
      supportBias: response.missions.state,
      severityBoost: response.missions.severityBoost,
      note: response.missions.note,
    },
    admin: {
      ...admin,
      note: highActionCount > 0 && pressureTier !== "quiet" ? `${admin.note} Action lanes are now hot enough to justify closer operator review.` : admin.note,
    },
  };
}

export function applyWorldConsequenceVendorPolicy(
  basePolicy: CityMudVendorSupportPolicy,
  consumers: WorldConsequenceConsumersView,
): CityMudVendorSupportPolicy {
  if (!consumers.summary.shouldNudgeRuntime && consumers.summary.pressureTier !== "watch") {
    return basePolicy;
  }

  const nextStock = clamp(basePolicy.recommendedStockMultiplier + consumers.vendor.stockMultiplierDelta, 0.5, 1.3);
  const nextPriceMin = clamp(basePolicy.recommendedPriceMinMultiplier + consumers.vendor.priceMinDelta, 0.8, 1.3);
  const nextPriceMax = clamp(basePolicy.recommendedPriceMaxMultiplier + consumers.vendor.priceMaxDelta, 1.0, 1.9);
  const nextCadence = clamp(basePolicy.recommendedRestockCadenceMultiplier + consumers.vendor.cadenceDelta, 0.7, 1.8);

  const state =
    consumers.summary.pressureTier === "severe"
      ? "restricted"
      : consumers.summary.pressureTier === "active"
      ? basePolicy.state === "restricted"
        ? "restricted"
        : "pressured"
      : basePolicy.state;

  return {
    ...basePolicy,
    state,
    stockPosture:
      consumers.summary.pressureTier === "severe"
        ? "restrict"
        : consumers.summary.pressureTier === "active"
        ? basePolicy.stockPosture === "expand"
          ? "maintain"
          : "throttle"
        : basePolicy.stockPosture,
    pricePosture:
      consumers.summary.pressureTier === "severe"
        ? "surge_guard"
        : consumers.summary.pressureTier === "active"
        ? "caution"
        : basePolicy.pricePosture,
    cadencePosture:
      consumers.summary.pressureTier === "severe"
        ? "triage"
        : consumers.summary.pressureTier === "active"
        ? "slow"
        : basePolicy.cadencePosture,
    recommendedStockMultiplier: nextStock,
    recommendedPriceMinMultiplier: nextPriceMin,
    recommendedPriceMaxMultiplier: nextPriceMax,
    recommendedRestockCadenceMultiplier: nextCadence,
    headline:
      consumers.summary.pressureTier === "quiet"
        ? basePolicy.headline
        : `${basePolicy.headline} Consequence pressure now reinforces that posture.`,
    detail: `${basePolicy.detail} ${consumers.vendor.note}`.trim(),
    recommendedAction: `${basePolicy.recommendedAction} ${consumers.vendor.note}`.trim(),
  };
}

export function applyWorldConsequenceMissionGuidance(
  baseGuidance: MissionOfferSupportGuidance,
  consumers: WorldConsequenceConsumersView,
): MissionOfferSupportGuidance {
  if (consumers.missions.supportBias === "none") {
    return baseGuidance;
  }

  const nextState =
    consumers.missions.supportBias === "restricted"
      ? "restricted"
      : baseGuidance.state === "restricted"
      ? "restricted"
      : "pressured";

  return {
    ...baseGuidance,
    state: nextState,
    severity: clamp(baseGuidance.severity + consumers.missions.severityBoost, 0, 100),
    headline:
      nextState === "restricted"
        ? "Mission support is now in consequence-aware defensive triage."
        : "Mission support is now under exported consequence pressure.",
    detail: `${baseGuidance.detail} ${consumers.missions.note}`.trim(),
    recommendedAction: `${baseGuidance.recommendedAction} ${consumers.missions.note}`.trim(),
  };
}
