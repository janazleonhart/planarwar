//web-backend/domain/economyCartelResponse.ts

import type { PlayerState } from "../gameState";
import type { WorldConsequenceState } from "./worldConsequences";

export type BlackMarketRuntimeState = "locked" | "latent" | "opening" | "active" | "surging";
export type BlackMarketResponsePosture = "ignore" | "watch" | "probe" | "exploit" | "contain";
export type CartelResponseTier = "none" | "watch" | "probing" | "active" | "crackdown";
export type CartelResponsePosture = "none" | "opportunistic" | "probing" | "predatory" | "coercive";

export interface EconomyCartelBlackMarketResponse {
  unlocked: boolean;
  state: BlackMarketRuntimeState;
  posture: BlackMarketResponsePosture;
  opportunityScore: number;
  heat: number;
  driverRegionId: string | null;
  shouldNudgeRuntime: boolean;
  note: string;
}

export interface EconomyCartelCartelResponse {
  tier: CartelResponseTier;
  posture: CartelResponsePosture;
  attention: number;
  shouldNudgeRuntime: boolean;
  note: string;
}

export interface EconomyCartelMissionPressureResponse {
  state: "none" | "pressured" | "restricted";
  severityBoost: number;
  note: string;
}

export interface EconomyCartelVendorPressureResponse {
  state: "none" | "pressured" | "restricted";
  laneBias: "none" | "essentials_only" | "luxury_throttle" | "arcane_caution";
  stockMultiplierDelta: number;
  priceMinDelta: number;
  priceMaxDelta: number;
  cadenceDelta: number;
  note: string;
}

export interface EconomyCartelResponseSummary {
  headline: string;
  responsePhase: "quiet" | "watch" | "active" | "severe";
  shouldNudgeRuntime: boolean;
  sourceRegionId: string | null;
  note: string;
}

export interface EconomyCartelResponseState {
  summary: EconomyCartelResponseSummary;
  blackMarket: EconomyCartelBlackMarketResponse;
  cartel: EconomyCartelCartelResponse;
  missions: EconomyCartelMissionPressureResponse;
  vendors: EconomyCartelVendorPressureResponse;
}

function safeState(ps: PlayerState, state?: WorldConsequenceState | null): WorldConsequenceState {
  return state ?? ps.worldConsequenceState ?? {
    regions: [],
    worldEconomy: { tradePressure: 0, supplyFriction: 0, cartelAttention: 0, destabilization: 0, outlook: "stable" },
    blackMarket: { opportunityScore: 0, heat: 0, outlook: "quiet" },
    factionPressure: { driftScore: 0, instability: 0, dominantStance: "stable" },
    summary: { affectedRegionIds: [], totalLedgerEntries: 0, severeCount: 0, destabilizationScore: 0, note: "No propagated consequence pressure yet." },
  } satisfies WorldConsequenceState;
}


function isBlackMarketLaneUnlocked(ps: PlayerState): boolean {
  return ps.city?.settlementLane === "black_market";
}

function hottestRegionId(state: WorldConsequenceState): string | null {
  const topRegion = [...(state.regions ?? [])].sort((a, b) => {
    const scoreA = Number(a.tradeDisruption ?? 0) + Number(a.blackMarketHeat ?? 0) + Math.abs(Number(a.factionDrift ?? 0));
    const scoreB = Number(b.tradeDisruption ?? 0) + Number(b.blackMarketHeat ?? 0) + Math.abs(Number(b.factionDrift ?? 0));
    return scoreB - scoreA;
  })[0];
  return topRegion?.regionId ?? state.summary?.affectedRegionIds?.[0] ?? null;
}

export function deriveEconomyCartelResponseState(ps: PlayerState, state?: WorldConsequenceState | null): EconomyCartelResponseState {
  const current = safeState(ps, state);
  const sourceRegionId = hottestRegionId(current);
  const unlocked = isBlackMarketLaneUnlocked(ps);
  const opportunityScore = Number(current.blackMarket?.opportunityScore ?? 0);
  const heat = Number(current.blackMarket?.heat ?? 0);
  const cartelAttention = Number(current.worldEconomy?.cartelAttention ?? 0);
  const destabilization = Number(current.summary?.destabilizationScore ?? current.worldEconomy?.destabilization ?? 0);
  const severeCount = Number(current.summary?.severeCount ?? 0);
  const totalLedgerEntries = Number(current.summary?.totalLedgerEntries ?? 0);

  let blackMarketState: BlackMarketRuntimeState = "latent";
  if (!unlocked) {
    blackMarketState = opportunityScore >= 10 || heat >= 8 ? "opening" : "locked";
  } else if (opportunityScore >= 18 || heat >= 14 || current.blackMarket?.outlook === "surging") {
    blackMarketState = "surging";
  } else if (opportunityScore >= 6 || current.blackMarket?.outlook === "active") {
    blackMarketState = "active";
  } else if (opportunityScore > 0 || heat > 0) {
    blackMarketState = "opening";
  }

  const blackMarketPosture: BlackMarketResponsePosture =
    blackMarketState === "surging"
      ? heat >= opportunityScore
        ? "contain"
        : "exploit"
      : blackMarketState === "active"
      ? heat >= 8
        ? "contain"
        : "probe"
      : blackMarketState === "opening"
      ? "watch"
      : "ignore";

  let cartelTier: CartelResponseTier = "none";
  if (cartelAttention >= 18 || (blackMarketState === "surging" && heat >= 12)) cartelTier = "crackdown";
  else if (cartelAttention >= 8 || blackMarketState === "active" || blackMarketState === "surging") cartelTier = "active";
  else if (cartelAttention >= 4 || blackMarketState === "opening") cartelTier = "probing";
  else if (cartelAttention >= 1) cartelTier = "watch";

  const cartelPosture: CartelResponsePosture =
    cartelTier === "crackdown"
      ? "coercive"
      : cartelTier === "active"
      ? "predatory"
      : cartelTier === "probing"
      ? "probing"
      : cartelTier === "watch"
      ? "opportunistic"
      : "none";

  const responsePhase: EconomyCartelResponseSummary["responsePhase"] =
    severeCount >= 2 || destabilization >= 32 || blackMarketState === "surging" || cartelTier === "crackdown"
      ? "severe"
      : totalLedgerEntries > 0 || severeCount > 0 || destabilization >= 8 || blackMarketState === "active" || cartelTier === "active"
      ? "active"
      : destabilization >= 4 || blackMarketState === "opening" || cartelTier === "probing"
      ? "watch"
      : "quiet";

  const shouldNudgeRuntime = responsePhase === "active" || responsePhase === "severe";

  const vendors: EconomyCartelVendorPressureResponse =
    responsePhase === "severe"
      ? {
          state: "restricted",
          laneBias: "essentials_only",
          stockMultiplierDelta: -0.22,
          priceMinDelta: 0.08,
          priceMaxDelta: 0.18,
          cadenceDelta: 0.28,
          note: "Severe economy/cartel response should materially tighten non-essential shelves and protect essentials first.",
        }
      : responsePhase === "active"
      ? {
          state: "pressured",
          laneBias: blackMarketState === "active" || blackMarketState === "surging" ? "luxury_throttle" : "arcane_caution",
          stockMultiplierDelta: -0.14,
          priceMinDelta: 0.04,
          priceMaxDelta: 0.12,
          cadenceDelta: 0.18,
          note: "Active economy/cartel response should tighten vendor posture beyond bridge-only guidance.",
        }
      : responsePhase === "watch"
      ? {
          state: "pressured",
          laneBias: "none",
          stockMultiplierDelta: -0.06,
          priceMinDelta: 0.02,
          priceMaxDelta: 0.06,
          cadenceDelta: 0.08,
          note: "Warming economy/cartel response justifies guarded vendor caution, not full scarcity theater.",
        }
      : {
          state: "none",
          laneBias: "none",
          stockMultiplierDelta: 0,
          priceMinDelta: 0,
          priceMaxDelta: 0,
          cadenceDelta: 0,
          note: "No economy/cartel response is strong enough to tighten vendors yet.",
        };

  const missions: EconomyCartelMissionPressureResponse =
    responsePhase === "severe"
      ? {
          state: "restricted",
          severityBoost: 22,
          note: "Mission pressure should assume defensive triage while severe economy/cartel response is active.",
        }
      : responsePhase === "active"
      ? {
          state: "pressured",
          severityBoost: 12,
          note: "Mission guidance should acknowledge live economy/cartel pressure and logistics drag.",
        }
      : responsePhase === "watch"
      ? {
          state: "pressured",
          severityBoost: 5,
          note: "Mission guidance should add caution text while economy/cartel pressure is warming up.",
        }
      : {
          state: "none",
          severityBoost: 0,
          note: "Mission support does not need extra economy/cartel caution right now.",
        };

  const blackMarketNote =
    !unlocked
      ? blackMarketState === "opening"
        ? "The world is opening illicit seams, but this settlement was founded on the civic lane and cannot exploit them directly."
        : "No black-market runtime state is available because this settlement is currently on the civic lane."
      : blackMarketState === "surging"
      ? "Black-market runtime state is surging: this is actionable upside with cartel risk attached."
      : blackMarketState === "active"
      ? "Black-market runtime state is active and should be treated as a real pressure/opportunity window."
      : blackMarketState === "opening"
      ? "Black-market runtime state is opening but not fully mature yet."
      : "No meaningful black-market runtime state is active right now.";

  const cartelNote =
    cartelTier === "crackdown"
      ? "Cartel response has escalated into crackdown territory; downstream systems should assume coercive interference."
      : cartelTier === "active"
      ? "Cartel response is active enough to distort routes, prices, or recovery behavior."
      : cartelTier === "probing"
      ? "Cartel response is probing for weak lanes and soft recovery targets."
      : cartelTier === "watch"
      ? "Cartel attention exists, but remains opportunistic rather than committed."
      : "Cartel response is currently dormant.";

  const headline =
    responsePhase === "severe"
      ? "Economy/cartel response is severe enough to justify bounded runtime tightening."
      : responsePhase === "active"
      ? "Economy/cartel response is live and should now alter vendor and mission behavior."
      : responsePhase === "watch"
      ? "Economy/cartel response is warming up and should stay visible across surfaces."
      : "Economy/cartel response is quiet.";

  return {
    summary: {
      headline,
      responsePhase,
      shouldNudgeRuntime,
      sourceRegionId,
      note: current.summary?.note ?? "No propagated consequence pressure yet.",
    },
    blackMarket: {
      unlocked,
      state: blackMarketState,
      posture: blackMarketPosture,
      opportunityScore,
      heat,
      driverRegionId: sourceRegionId,
      shouldNudgeRuntime: unlocked && (blackMarketState === "active" || blackMarketState === "surging"),
      note: blackMarketNote,
    },
    cartel: {
      tier: cartelTier,
      posture: cartelPosture,
      attention: cartelAttention,
      shouldNudgeRuntime: cartelTier === "active" || cartelTier === "crackdown",
      note: cartelNote,
    },
    missions,
    vendors,
  };
}
