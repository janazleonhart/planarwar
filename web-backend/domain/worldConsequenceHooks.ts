//web-backend/domain/worldConsequenceHooks.ts

import type { PlayerState } from "../gameState";
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
  return regions.slice(0, 3).map((region) => ({
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
  const unlocked = (ps.techFlags ?? []).includes("BLACK_MARKET_ENABLED");
  const opportunity = Number(state.blackMarket?.opportunityScore ?? 0);
  const heat = Number(state.blackMarket?.heat ?? 0);
  const outlook = state.blackMarket?.outlook ?? "quiet";

  if (!unlocked) {
    const status = opportunity >= 10 || heat >= 8 ? "opening" : "locked";
    return {
      unlocked,
      status,
      opportunityScore: opportunity,
      heat,
      driverRegionId: hottestRegionId,
      recommendedPosture: status === "opening" ? "watch" : "ignore",
      note:
        status === "opening"
          ? "The world is opening black-market seams, but the city lacks the contacts or doctrine to use them yet."
          : "No actionable black-market hook is live because the city has not unlocked that lane.",
    };
  }

  if (outlook === "surging" || opportunity >= 18 || heat >= 14) {
    return {
      unlocked,
      status: "surging",
      opportunityScore: opportunity,
      heat,
      driverRegionId: hottestRegionId,
      recommendedPosture: heat >= opportunity ? "contain" : "exploit",
      note: "Consequences have opened an aggressive black-market window. This is profit with teeth, not a harmless side alley.",
    };
  }

  if (outlook === "active" || opportunity >= 6) {
    return {
      unlocked,
      status: "active",
      opportunityScore: opportunity,
      heat,
      driverRegionId: hottestRegionId,
      recommendedPosture: heat >= 8 ? "contain" : "probe",
      note: "City consequence pressure is generating a real black-market opportunity window.",
    };
  }

  return {
    unlocked,
    status: opportunity > 0 || heat > 0 ? "opening" : "latent",
    opportunityScore: opportunity,
    heat,
    driverRegionId: hottestRegionId,
    recommendedPosture: opportunity > 0 || heat > 0 ? "watch" : "ignore",
    note:
      opportunity > 0 || heat > 0
        ? "Weak illicit trade seams are appearing, but they are not fully mature yet."
        : "No meaningful black-market hook is active right now.",
  };
}

function deriveCartelHook(state: WorldConsequenceState): WorldConsequenceCartelHook {
  const attention = Number(state.worldEconomy?.cartelAttention ?? 0);
  if (attention >= 18) {
    return {
      attention,
      pressureTier: "severe",
      responseBias: "predatory",
      note: "Cartel attention is severe. Expect exploitation attempts, coercive pricing, or route capture behavior.",
    };
  }
  if (attention >= 8) {
    return {
      attention,
      pressureTier: "active",
      responseBias: "probing",
      note: "Cartel pressure is active enough to probe weak supply lanes and civic recovery efforts.",
    };
  }
  if (attention >= 3) {
    return {
      attention,
      pressureTier: "watch",
      responseBias: "opportunistic",
      note: "Cartel attention exists, but mostly as opportunistic pressure rather than committed aggression.",
    };
  }
  return {
    attention,
    pressureTier: "low",
    responseBias: "none",
    note: "Cartel pressure is currently low.",
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
  const cartel = deriveCartelHook(safeState);
  const worldEconomy = deriveWorldEconomyHook(safeState);
  const faction = deriveFactionHook(safeState);

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
