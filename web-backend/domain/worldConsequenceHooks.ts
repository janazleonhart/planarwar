//web-backend/domain/worldConsequenceHooks.ts

import type { PlayerState } from "../gameState";
import { deriveEconomyCartelResponseState } from "./economyCartelResponse";
import type { WorldConsequenceBlackMarketState, WorldConsequenceFactionPressureState, WorldConsequenceRegionState, WorldConsequenceState, WorldConsequenceWorldEconomyState } from "./worldConsequences";

export interface WorldConsequenceHookHotspot {
  regionId: string;
  tradeDisruption: number;
  blackMarketHeat: number;
  factionDrift: number;
  note: string;
}

export interface WorldConsequenceBlackMarketHook {
  unlocked: boolean;
  status: "locked" | "latent" | "opening" | "active" | "surging";
  opportunityScore: number;
  heat: number;
  driverRegionId: string | null;
  recommendedPosture: "ignore" | "watch" | "probe" | "exploit" | "contain";
  note: string;
}

export interface WorldConsequenceCartelHook {
  attention: number;
  pressureTier: "low" | "watch" | "active" | "severe";
  responseBias: "none" | "opportunistic" | "probing" | "predatory";
  note: string;
}

export interface WorldConsequenceWorldEconomyHook {
  tradePressure: number;
  supplyFriction: number;
  outlook: WorldConsequenceWorldEconomyState["outlook"];
  riskTier: "low" | "watch" | "active" | "severe";
  note: string;
}

export interface WorldConsequenceFactionHook {
  dominantStance: WorldConsequenceFactionPressureState["dominantStance"];
  instability: number;
  responseBias: "quiet" | "watch" | "fracture_risk";
  note: string;
}

export interface WorldConsequenceHooksSummary {
  hasActiveHooks: boolean;
  headline: string;
  topRegionIds: string[];
}

export interface WorldConsequenceHooksView {
  blackMarket: WorldConsequenceBlackMarketHook;
  cartel: WorldConsequenceCartelHook;
  worldEconomy: WorldConsequenceWorldEconomyHook;
  faction: WorldConsequenceFactionHook;
  hotspots: WorldConsequenceHookHotspot[];
  summary: WorldConsequenceHooksSummary;
}

function topHotspots(regions: WorldConsequenceRegionState[]): WorldConsequenceHookHotspot[] {
  return regions
    .filter((region) => {
      const footprint =
        Number(region.tradeDisruption ?? 0)
        + Number(region.blackMarketHeat ?? 0)
        + Number(region.factionDrift ?? 0)
        + Math.max(0, Number(region.netPressure ?? 0))
        + Math.max(0, Number(region.netRecoveryLoad ?? 0))
        + Math.max(0, Number(region.threatDrift ?? 0))
        + Math.abs(Number(region.controlDrift ?? 0));

      return footprint >= 3;
    })
    .slice(0, 3)
    .map((region) => ({
      regionId: region.regionId,
      tradeDisruption: region.tradeDisruption,
      blackMarketHeat: region.blackMarketHeat,
      factionDrift: region.factionDrift,
      note:
        region.blackMarketHeat >= 10
          ? "Black-market pressure is visibly pooling here."
          : region.tradeDisruption >= 8
          ? "Trade disruption is turning this region into a soft target."
          : region.factionDrift >= 6
          ? "Faction drift is widening local political cracks."
          : "This region is carrying the strongest exported consequence load.",
    }));
}

function deriveBlackMarketHook(ps: PlayerState, state: WorldConsequenceState, hottestRegionId: string | null): WorldConsequenceBlackMarketHook {
  const response = deriveEconomyCartelResponseState(ps, state);
  return {
    unlocked: response.blackMarket.unlocked,
    status: response.blackMarket.state,
    opportunityScore: response.blackMarket.opportunityScore,
    heat: response.blackMarket.heat,
    driverRegionId: hottestRegionId,
    recommendedPosture: response.blackMarket.posture,
    note: response.blackMarket.note,
  };
}

function deriveCartelHook(ps: PlayerState, state: WorldConsequenceState): WorldConsequenceCartelHook {
  const response = deriveEconomyCartelResponseState(ps, state);
  const tierMap: Record<string, WorldConsequenceCartelHook["pressureTier"]> = {
    none: "low",
    watch: "watch",
    probing: "watch",
    active: "active",
    crackdown: "severe",
  };
  const postureMap: Record<string, WorldConsequenceCartelHook["responseBias"]> = {
    none: "none",
    opportunistic: "opportunistic",
    probing: "probing",
    predatory: "predatory",
    coercive: "predatory",
  };
  return {
    attention: response.cartel.attention,
    pressureTier: tierMap[response.cartel.tier] ?? "low",
    responseBias: postureMap[response.cartel.posture] ?? "none",
    note: response.cartel.note,
  };
}

function deriveWorldEconomyHook(state: WorldConsequenceState): WorldConsequenceWorldEconomyHook {
  const tradePressure = Number(state.worldEconomy?.tradePressure ?? 0);
  const supplyFriction = Number(state.worldEconomy?.supplyFriction ?? 0);
  const destabilization = Number(state.worldEconomy?.destabilization ?? 0);
  const outlook = state.worldEconomy?.outlook ?? "stable";

  const riskTier = destabilization >= 30 ? "severe" : destabilization >= 12 ? "active" : destabilization >= 4 ? "watch" : "low";
  const note =
    riskTier === "severe"
      ? "World-economy pressure is severe enough to justify visible scarcity, diversion, or reroute behavior."
      : riskTier === "active"
      ? "World-economy pressure is active and should feed downstream scarcity or routing systems."
      : riskTier === "watch"
      ? "The economy hook is live, but still in early watch territory."
      : "World-economy pressure is currently quiet.";

  return { tradePressure, supplyFriction, outlook, riskTier, note };
}

function deriveFactionHook(state: WorldConsequenceState): WorldConsequenceFactionHook {
  const dominantStance = state.factionPressure?.dominantStance ?? "stable";
  const instability = Number(state.factionPressure?.instability ?? 0);
  const responseBias = dominantStance === "fracturing" || instability >= 20 ? "fracture_risk" : dominantStance === "watch" || dominantStance === "destabilizing" ? "watch" : "quiet";
  const note =
    responseBias === "fracture_risk"
      ? "Faction posture is unstable enough to justify downstream consequence propagation or conflict hooks."
      : responseBias === "watch"
      ? "Faction pressure is present and should remain visible to consequence consumers."
      : "Faction posture is currently steady.";

  return { dominantStance, instability, responseBias, note };
}

export function deriveWorldConsequenceHooks(ps: PlayerState, state?: WorldConsequenceState | null): WorldConsequenceHooksView {
  const safeState = state ?? ps.worldConsequenceState ?? {
    regions: [],
    worldEconomy: { tradePressure: 0, supplyFriction: 0, cartelAttention: 0, destabilization: 0, outlook: "stable" },
    blackMarket: { opportunityScore: 0, heat: 0, outlook: "quiet" },
    factionPressure: { driftScore: 0, instability: 0, dominantStance: "stable" },
    summary: { affectedRegionIds: [], totalLedgerEntries: 0, severeCount: 0, destabilizationScore: 0, note: "No propagated consequence pressure yet." },
  } satisfies WorldConsequenceState;

  const hotspots = topHotspots(safeState.regions ?? []);
  const hottestRegionId = hotspots[0]?.regionId ?? safeState.summary?.affectedRegionIds?.[0] ?? null;
  const blackMarket = deriveBlackMarketHook(ps, safeState, hottestRegionId);
  const cartel = deriveCartelHook(ps, safeState);
  const worldEconomy = deriveWorldEconomyHook(safeState);
  const faction = deriveFactionHook(safeState);

  const hasResidualPressure =
    hotspots.length > 0
    || blackMarket.status !== "latent"
    || cartel.pressureTier !== "low"
    || worldEconomy.riskTier !== "low"
    || faction.responseBias !== "quiet";

  const hasActiveHooks =
    blackMarket.status === "active" ||
    blackMarket.status === "surging" ||
    cartel.pressureTier === "active" ||
    cartel.pressureTier === "severe" ||
    worldEconomy.riskTier === "active" ||
    worldEconomy.riskTier === "severe" ||
    faction.responseBias === "fracture_risk";

  const headline = !safeState.summary || safeState.summary.totalLedgerEntries <= 0
    ? "No world consequence hooks are live yet."
    : !hasResidualPressure
    ? "Previously exported pressure has cooled and the hook layer is quiet again."
    : blackMarket.status === "surging"
    ? "Black-market opportunity is surging and cartel teeth are showing."
    : blackMarket.status === "active"
    ? "A live black-market window is open off exported city pressure."
    : cartel.pressureTier === "severe"
    ? "Cartel attention is severe enough to distort regional routes."
    : worldEconomy.riskTier === "active" || faction.responseBias !== "quiet"
    ? "World consequence pressure is now feeding economy and faction hooks."
    : "World consequence hooks are seeded but still mild.";

  return {
    blackMarket,
    cartel,
    worldEconomy,
    faction,
    hotspots,
    summary: {
      hasActiveHooks,
      headline,
      topRegionIds: hotspots.map((entry) => entry.regionId),
    },
  };
}
