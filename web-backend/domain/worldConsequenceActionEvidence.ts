//web-backend/domain/worldConsequenceActionEvidence.ts

import type { WorldConsequenceState } from "./worldConsequences";
import type { WorldConsequenceHooksView } from "./worldConsequenceHooks";
import type { WorldConsequenceActionEvidenceItem } from "./worldConsequenceActions";

function toneForValue(value: number): "watch" | "high" | "critical" {
  if (value >= 12) return "critical";
  if (value >= 6) return "high";
  return "watch";
}

function buildEconomyEvidence(
  propagated: WorldConsequenceState,
): WorldConsequenceActionEvidenceItem[] {
  return [
    {
      label: "trade pressure",
      value: Number(propagated.worldEconomy.tradePressure ?? 0),
      tone: toneForValue(Number(propagated.worldEconomy.tradePressure ?? 0)),
    },
    {
      label: "supply friction",
      value: Number(propagated.worldEconomy.supplyFriction ?? 0),
      tone: toneForValue(Number(propagated.worldEconomy.supplyFriction ?? 0)),
    },
    {
      label: "destabilization",
      value: Number(propagated.summary?.destabilizationScore ?? 0),
      tone: toneForValue(Number(propagated.summary?.destabilizationScore ?? 0)),
    },
  ].filter((entry) => entry.value > 0);
}

function buildFactionEvidence(
  propagated: WorldConsequenceState,
): WorldConsequenceActionEvidenceItem[] {
  return [
    {
      label: "instability",
      value: Number(propagated.factionPressure.instability ?? 0),
      tone: toneForValue(Number(propagated.factionPressure.instability ?? 0)),
    },
    {
      label: "drift score",
      value: Number(propagated.factionPressure.driftScore ?? 0),
      tone: toneForValue(Number(propagated.factionPressure.driftScore ?? 0)),
    },
  ].filter((entry) => entry.value > 0);
}

function buildCartelOrBlackMarketEvidence(
  propagated: WorldConsequenceState,
  hooks: WorldConsequenceHooksView,
): WorldConsequenceActionEvidenceItem[] {
  return [
    {
      label: "cartel attention",
      value: Number(hooks.cartel.attention ?? 0),
      tone: toneForValue(Number(hooks.cartel.attention ?? 0)),
    },
    {
      label: "black-market heat",
      value: Number(propagated.blackMarket.heat ?? 0),
      tone: toneForValue(Number(propagated.blackMarket.heat ?? 0)),
    },
    {
      label: "opportunity",
      value: Number(propagated.blackMarket.opportunityScore ?? 0),
      tone: toneForValue(Number(propagated.blackMarket.opportunityScore ?? 0)),
    },
  ].filter((entry) => entry.value > 0);
}

function buildRegionalEvidence(
  hooks: WorldConsequenceHooksView,
  sourceRegionId: string | null,
): WorldConsequenceActionEvidenceItem[] {
  const hotspot = hooks.hotspots.find((entry) => entry.regionId === sourceRegionId) ?? hooks.hotspots[0];
  if (!hotspot) return [];
  return [
    {
      label: "regional trade disruption",
      value: Number(hotspot.tradeDisruption ?? 0),
      tone: toneForValue(Number(hotspot.tradeDisruption ?? 0)),
    },
    {
      label: "regional black-market heat",
      value: Number(hotspot.blackMarketHeat ?? 0),
      tone: toneForValue(Number(hotspot.blackMarketHeat ?? 0)),
    },
    {
      label: "regional faction drift",
      value: Number(hotspot.factionDrift ?? 0),
      tone: toneForValue(Number(hotspot.factionDrift ?? 0)),
    },
  ].filter((entry) => entry.value > 0);
}

export function buildWorldConsequenceActionEvidence(
  actionId: string,
  propagated: WorldConsequenceState | null,
  hooks: WorldConsequenceHooksView,
  sourceRegionId: string | null,
): WorldConsequenceActionEvidenceItem[] {
  if (!propagated) return [];

  if (actionId === "action_stabilize_supply_lanes") {
    return buildEconomyEvidence(propagated);
  }

  if (actionId === "action_faction_stability") {
    return buildFactionEvidence(propagated);
  }

  if (
    actionId === "action_cartel_pressure" ||
    actionId === "action_black_market_window_contain" ||
    actionId === "action_black_market_window_exploit" ||
    actionId === "action_black_market_window_bribe"
  ) {
    return buildCartelOrBlackMarketEvidence(propagated, hooks);
  }

  if (actionId.startsWith("action_region_")) {
    return buildRegionalEvidence(hooks, sourceRegionId);
  }

  return [];
}
