//web-backend/domain/worldConsequenceConsumers.ts

import type { PlayerState } from "../gameState";
import type { CityMudVendorSupportPolicy } from "./cityMudBridge";
import type { MissionOfferSupportGuidance } from "./missions";
import type { WorldConsequenceActionsView } from "./worldConsequenceActions";
import { deriveWorldConsequenceActions } from "./worldConsequenceActions";
import type { WorldConsequenceHooksView } from "./worldConsequenceHooks";
import { deriveWorldConsequenceHooks } from "./worldConsequenceHooks";
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

  const destabilization = Number(safeState?.summary?.destabilizationScore ?? 0);
  const severeCount = Number(safeState?.summary?.severeCount ?? 0);
  const totalLedgerEntries = Number(safeState?.summary?.totalLedgerEntries ?? 0);
  const affectedRegionCount = Number(safeState?.summary?.affectedRegionIds?.length ?? 0);
  const hotspotCount = Number(safeHooks.hotspots?.length ?? 0);

  const blackMarketStatus = safeHooks.blackMarket.status;
  const cartelTier = safeHooks.cartel.pressureTier;
  const economyRisk = safeHooks.worldEconomy.riskTier;
  const factionBias = safeHooks.faction.responseBias;

  const highActionCount =
    (safeActions.playerActions ?? []).filter((a) => a.priority === "high" || a.priority === "critical").length
    + (safeActions.adminActions ?? []).filter((a) => a.priority === "high" || a.priority === "critical").length
    + (safeActions.motherBrainActions ?? []).filter((a) => a.priority === "high" || a.priority === "critical").length;

  const criticalActionCount =
    (safeActions.playerActions ?? []).filter((a) => a.priority === "critical").length
    + (safeActions.adminActions ?? []).filter((a) => a.priority === "critical").length
    + (safeActions.motherBrainActions ?? []).filter((a) => a.priority === "critical").length;

  const hasExplicitWorldPressure =
    totalLedgerEntries > 0 || severeCount > 0 || destabilization > 0 || affectedRegionCount > 0;

  let pressureTier: WorldConsequencePressureTier = "quiet";

  if (hasExplicitWorldPressure) {
    if (
      severeCount >= 2 ||
      destabilization >= 32 ||
      blackMarketStatus === "surging" ||
      cartelTier === "severe" ||
      factionBias === "fracture_risk" ||
      criticalActionCount > 1
    ) {
      pressureTier = "severe";
    } else if (
      totalLedgerEntries >= 1 ||
      severeCount >= 1 ||
      destabilization >= 8 ||
      blackMarketStatus === "active" ||
      cartelTier === "active" ||
      economyRisk === "active" ||
      economyRisk === "severe" ||
      safeHooks.summary.hasActiveHooks ||
      highActionCount > 0 ||
      hotspotCount > 0
    ) {
      pressureTier = "active";
    } else if (
      destabilization >= 4 ||
      blackMarketStatus === "latent" ||
      economyRisk === "watch" ||
      safeActions.recommendedPrimaryAction !== "observe"
    ) {
      pressureTier = "watch";
    }
  }

  const sourceRegionId = safeHooks.hotspots[0]?.regionId ?? safeState?.summary?.affectedRegionIds?.[0] ?? null;

  const vendor: WorldConsequenceVendorConsumer =
    pressureTier === "severe"
      ? {
          stockMultiplierDelta: -0.22,
          priceMinDelta: 0.08,
          priceMaxDelta: 0.18,
          cadenceDelta: 0.28,
          laneBias: "essentials_only",
          note: "Severe exported pressure should visibly tighten shelves, slow cadence, and protect essentials first.",
        }
      : pressureTier === "active"
      ? {
          stockMultiplierDelta: -0.14,
          priceMinDelta: 0.04,
          priceMaxDelta: 0.12,
          cadenceDelta: 0.18,
          laneBias:
            blackMarketStatus === "active" || blackMarketStatus === "surging"
              ? "luxury_throttle"
              : "arcane_caution",
          note: "Active exported pressure should tighten vendor posture beyond bridge-only logic.",
        }
      : pressureTier === "watch"
      ? {
          stockMultiplierDelta: -0.06,
          priceMinDelta: 0.02,
          priceMaxDelta: 0.06,
          cadenceDelta: 0.08,
          laneBias: "none",
          note: "Early exported pressure justifies a guarded vendor posture, but not full scarcity theater.",
        }
      : {
          stockMultiplierDelta: 0,
          priceMinDelta: 0,
          priceMaxDelta: 0,
          cadenceDelta: 0,
          laneBias: "none",
          note: "No exported consequence pressure is strong enough to nudge vendors yet.",
        };

  const missions: WorldConsequenceMissionConsumer =
    pressureTier === "severe"
      ? {
          supportBias: "restricted",
          severityBoost: 22,
          note: "Mission guidance should assume defensive triage while severe consequence pressure is active.",
        }
      : pressureTier === "active"
      ? {
          supportBias: "pressured",
          severityBoost: 12,
          note: "Mission guidance should acknowledge consequence pressure and visible logistics drag.",
        }
      : pressureTier === "watch"
      ? {
          supportBias: "pressured",
          severityBoost: 5,
          note: "Mission guidance should add caution text while consequence pressure is warming up.",
        }
      : {
          supportBias: "none",
          severityBoost: 0,
          note: "Mission support does not need extra consequence-aware caution right now.",
        };

  const admin: WorldConsequenceAdminConsumer = {
    auditWatch: pressureTier !== "quiet",
    cartelWatch: cartelTier === "active" || cartelTier === "severe" || blackMarketStatus === "surging",
    note:
      pressureTier === "quiet"
        ? "No admin consequence intervention is recommended yet."
        : pressureTier === "severe"
        ? "Admin surfaces should highlight consequence hotspots, vendor tightening, and cartel watch immediately."
        : "Admin surfaces should keep consequence pressure visible and auditable while it remains active.",
  };

  const headline =
    pressureTier === "severe"
      ? "World consequence pressure is severe enough to justify downstream runtime tightening."
      : pressureTier === "active"
      ? "Exported city pressure is now strong enough to nudge vendor and mission systems."
      : pressureTier === "watch"
      ? "Consequence pressure is warming up and should remain visible to downstream consumers."
      : "No downstream runtime nudges are justified yet.";

  return {
    summary: {
      pressureTier,
      headline,
      note: safeState?.summary?.note ?? "No propagated consequence pressure yet.",
      sourceRegionId,
      shouldNudgeRuntime: pressureTier === "active" || pressureTier === "severe",
    },
    vendor,
    missions,
    admin,
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
