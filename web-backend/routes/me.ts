import { Router } from "express";

import { defaultPolicies, summarizeCityAlphaScopeLock, summarizeCityAlphaStatus, tickPlayerState, type PlayerState } from "../gameState";
import { getAvailableTechsForPlayer, getTechById } from "../domain/tech";
import { deriveWorldConsequenceHooks } from "../domain/worldConsequenceHooks";
import { deriveWorldConsequenceActions } from "../domain/worldConsequenceActions";
import { getSettlementLanePreferredActionOrder } from "../domain/worldConsequenceActions";
import { summarizeWorldConsequenceResponseReceipts } from "../domain/worldConsequences";
import { deriveWorldConsequenceConsumers } from "../domain/worldConsequenceConsumers";
import { deriveEconomyCartelResponseState } from "../domain/economyCartelResponse";
import {
  getBuildingProductionPerTick,
  getCityProductionPerTick,
  getSettlementLaneProductionModifier,
  maxBuildingSlotsForTier,
  type BuildingKind,
} from "../domain/city";
import { applyMissionConsumerGuidance, generateMissionOffers, type MissionOffer } from "../domain/missions";
import { syncRecoveryContractsForState } from "../gameState/gameStateMissions";
import { deriveCityMudConsumers, summarizeCityMudBridge } from "../domain/cityMudBridge";
import { resolvePlayerAccess, resolveViewer, suggestCityName, withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

export type SettlementLaneResponseFocus = {
  preferredActionLanes: string[];
  advisoryTone: string;
  recommendedOpening: string;
  openingChecklist: string[];
};

export type SettlementLaneProfile = {
  id: "city" | "black_market";
  label: string;
  summary: string;
  posture: string;
  strengths: string[];
  liabilities: string[];
  responseFocus: SettlementLaneResponseFocus;
};

export type SettlementLaneReceipt = {
  title: string;
  summary: string;
  effects: string[];
};

export type SettlementLaneLatestReceipt = {
  title: string;
  message: string;
  kind: string;
  timestamp: string;
};

export type SettlementLaneNextActionHint = {
  title: string;
  summary: string;
  lane: string;
  priority: string;
};

export type SettlementOpeningAction =
  | { kind: "build_building"; buildingKind: BuildingKind }
  | { kind: "upgrade_building"; buildingId: string }
  | { kind: "start_mission"; missionId: string; heroId?: string; armyId?: string; responsePosture?: "cautious" | "balanced" | "aggressive" | "desperate" }
  | { kind: "execute_world_action"; actionId: string }
  | { kind: "recruit_hero"; role: "champion" | "scout" | "tactician" | "mage" };

export type SettlementOpeningOperation = {
  id: string;
  title: string;
  summary: string;
  whyNow: string;
  payoff: string;
  risk: string;
  lane: string;
  priority: "opening" | "high" | "watch";
  readiness: "ready_now" | "prepare_soon" | "blocked";
  ctaLabel: string;
  action: SettlementOpeningAction;
};

export type SettlementLaneResourceDelta = {
  food: number;
  materials: number;
  wealth: number;
  mana: number;
  knowledge: number;
  unity: number;
};

export type SettlementLaneStatDelta = {
  prosperity: number;
  influence: number;
  security: number;
  stability: number;
  unity: number;
};

export type SettlementLaneChoicePreview = {
  foundingResources: SettlementLaneResourceDelta;
  foundingStats: SettlementLaneStatDelta;
  passivePerTick: SettlementLaneResourceDelta;
  pressureFloor: {
    stage: "stable" | "strained"; 
    total: number;
    threatPressure: number;
    unityPressure: number;
  };
  runtimeAccess: string[];
};

export type SettlementLaneChoice = SettlementLaneProfile & {
  preview: SettlementLaneChoicePreview;
};

export function buildSettlementLaneChoice(lane: "city" | "black_market"): SettlementLaneChoice {
  if (lane === "black_market") {
    return {
      ...buildSettlementLaneProfile("black_market"),
      preview: {
        foundingResources: { food: 0, materials: 6, wealth: 18, mana: 0, knowledge: 4, unity: -2 },
        foundingStats: { prosperity: 6, influence: 8, security: -8, stability: -5, unity: -4 },
        passivePerTick: { food: 0, materials: 0, wealth: 2, mana: 0, knowledge: 1, unity: 0 },
        pressureFloor: { stage: "strained", total: 33, threatPressure: 8, unityPressure: 6 },
        runtimeAccess: [
          "Can act directly on black-market world consequence windows.",
          "Reads cartel and scarcity pressure through a shadow-lane lens.",
        ],
      },
    };
  }

  return {
    ...buildSettlementLaneProfile("city"),
    preview: {
      foundingResources: { food: 0, materials: 0, wealth: 0, mana: 0, knowledge: 0, unity: 0 },
      foundingStats: { prosperity: 0, influence: 0, security: 0, stability: 0, unity: 0 },
      passivePerTick: { food: 1, materials: 0, wealth: 0, mana: 0, knowledge: 0, unity: 1 },
      pressureFloor: { stage: "stable", total: 0, threatPressure: 0, unityPressure: 0 },
      runtimeAccess: [
        "Treats black-market pressure as outside pressure instead of a native lane.",
        "Prefers overt civic stabilization before shadow opportunism.",
      ],
    },
  };
}

export function buildSettlementLaneFoundingReceipt(lane: "city" | "black_market"): SettlementLaneReceipt {
  if (lane === "black_market") {
    return {
      title: "Black Market founding posture",
      summary: "This settlement opened as a shadow market: faster dirty upside, weaker legitimacy, and a hotter starting pressure picture.",
      effects: [
        "Starts with extra wealth, materials, and knowledge.",
        "Begins under a strained posture with higher threat and unity pressure.",
        "Can act directly on black-market windows instead of only observing them.",
      ],
    };
  }

  return {
    title: "City founding posture",
    summary: "This settlement opened on the civic baseline: steadier legitimacy, cleaner administration, and no native shadow lane.",
    effects: [
      "Starts from the standard civic baseline.",
      "Generates a passive civic surplus of food and unity each tick.",
      "Treats black-market pressure as outside pressure instead of a native lane.",
      "Built for orderly public growth rather than deniable leverage.",
    ],
  };
}

export function buildSettlementLaneProfile(lane: "city" | "black_market"): SettlementLaneProfile {
  if (lane === "black_market") {
    return {
      id: "black_market",
      label: "Black Market",
      summary: "Shadow-rooted settlement with deniable leverage, illicit openings, and a riskier opening posture.",
      posture: "fast profit, weaker legitimacy, hotter starting pressure",
      strengths: [
        "Starts with extra wealth, materials, and knowledge",
        "Can act directly on black-market world consequence windows",
        "Built for deniable leverage instead of orderly civic growth",
        "Generates a passive shadow surplus of wealth and knowledge each tick",
      ],
      liabilities: [
        "Opens with lower security, stability, and civic unity",
        "Carries a strained early posture instead of a clean civic start",
        "Shadow gains are stronger, but legitimacy and trust cost more",
      ],
      responseFocus: {
        preferredActionLanes: getSettlementLanePreferredActionOrder("black_market"),
        advisoryTone: "shadow-pressure management",
        recommendedOpening: "Secure illicit throughput and cool cartel heat before public strain turns the shadow lane into a trap.",
        openingChecklist: [
          "Secure wealth and knowledge throughput before strain compounds.",
          "Cool cartel heat early so pressure stays transactional instead of coercive.",
          "Do not let public instability trap the shadow lane before it pays for itself.",
        ],
      },
    };
  }

  return {
    id: "city",
    label: "City",
    summary: "Orderly civic settlement with public desks, visible administration, and steadier formal development.",
    posture: "steady growth, cleaner legitimacy, slower shadow upside",
    strengths: [
      "Starts from the standard civic baseline",
      "Generates a passive civic surplus of food and unity each tick",
      "Built for overt administration, public infrastructure, and stable growth",
      "Keeps illicit pressure as outside pressure instead of a native lane",
    ],
    liabilities: [
      "Shadow-economy openings stay indirect unless you later pivot design",
      "Less front-loaded dirty profit than a black-market start",
      "Relies more on formal growth than deniable leverage",
    ],
    responseFocus: {
      preferredActionLanes: getSettlementLanePreferredActionOrder("city"),
      advisoryTone: "civic stabilization",
      recommendedOpening: "Stabilize supply, logistics, and public order before chasing shadow upside.",
      openingChecklist: [
        "Stabilize food and unity generation before taking on optional strain.",
        "Keep logistics and public order steady so early setbacks do not cascade.",
        "Treat black-market pressure as an external risk until the civic core is secure.",
      ],
    },
  };
}


export function buildSettlementLaneLatestReceipt(ps: PlayerState): SettlementLaneLatestReceipt {
  const lane = ps.city.settlementLane === "black_market" ? "black_market" : "city";
  const events = [...(ps.eventLog ?? [])].reverse();
  const match = events.find((event) => {
    if (event.kind !== "city_morph") return false;
    if (lane === "black_market") {
      return /black market|shadow surplus|secure illicit throughput/i.test(event.message);
    }
    return /city founding posture|civic surplus|stabilize supply, logistics, and public order/i.test(event.message);
  });

  if (match) {
    return {
      title: lane === "black_market" ? "Latest shadow receipt" : "Latest civic receipt",
      message: match.message,
      kind: match.kind,
      timestamp: match.timestamp,
    };
  }

  return {
    title: lane === "black_market" ? "Latest shadow receipt" : "Latest civic receipt",
    message: lane === "black_market"
      ? "No shadow receipt has landed yet. Watch for the first black-market founding or passive event."
      : "No civic receipt has landed yet. Watch for the first city founding or passive event.",
    kind: "city_morph",
    timestamp: new Date(0).toISOString(),
  };
}


export function buildSettlementLaneNextActionHint(ps: PlayerState): SettlementLaneNextActionHint {
  const actions = deriveWorldConsequenceActions(ps);
  const top = actions.playerActions[0];
  if (top) {
    return {
      title: top.title,
      summary: top.summary,
      lane: top.lane,
      priority: top.priority,
    };
  }

  const lane = ps.city.settlementLane === "black_market" ? "black_market" : "city";
  const profile = buildSettlementLaneProfile(lane);
  return {
    title: lane === "black_market" ? "Shadow lane opening focus" : "Civic opening focus",
    summary: profile.responseFocus.recommendedOpening,
    lane: profile.responseFocus.preferredActionLanes[0] ?? (lane === "black_market" ? "black_market" : "economy"),
    priority: "watch",
  };
}

function scoreHeroForMission(ps: PlayerState, mission: MissionOffer, heroId: string | undefined): number {
  if (!heroId) return -1;
  const hero = ps.heroes.find((entry) => entry.id === heroId && entry.status === "idle");
  if (!hero) return -1;
  const responseTags = new Set(mission.responseTags ?? []);
  const matchScore = hero.responseRoles.reduce((acc, role) => acc + (responseTags.has(role) ? 30 : 0), 0);
  return matchScore + (hero.power ?? 0);
}

function scoreArmyForMission(ps: PlayerState, mission: MissionOffer, armyId: string | undefined): number {
  if (!armyId) return -1;
  const army = ps.armies.find((entry) => entry.id === armyId && entry.status === "idle");
  if (!army) return -1;
  const responseTags = new Set(mission.responseTags ?? []);
  const matchScore = army.specialties.reduce((acc, role) => acc + (responseTags.has(role) ? 20 : 0), 0);
  return matchScore + (army.readiness ?? 0) + (army.power ?? 0);
}

function chooseBestHeroForMission(ps: PlayerState, mission: MissionOffer): string | undefined {
  return [...ps.heroes]
    .filter((hero) => hero.status === "idle")
    .sort((a, b) => scoreHeroForMission(ps, mission, b.id) - scoreHeroForMission(ps, mission, a.id))[0]?.id;
}

function chooseBestArmyForMission(ps: PlayerState, mission: MissionOffer): string | undefined {
  return [...ps.armies]
    .filter((army) => army.status === "idle")
    .sort((a, b) => scoreArmyForMission(ps, mission, b.id) - scoreArmyForMission(ps, mission, a.id))[0]?.id;
}

function getMissionDifficultyRank(difficulty: MissionOffer["difficulty"]): number {
  switch (difficulty) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
    case "extreme":
      return 3;
    default:
      return 4;
  }
}


const OPENING_BUILD_BASE_COSTS: Partial<Record<BuildingKind, { materials: number; wealth: number; mana?: number }>> = {
  farmland: { materials: 50, wealth: 20 },
  arcane_spire: { materials: 70, wealth: 50, mana: 30 },
};

const OPENING_HERO_RECRUIT_COSTS: Record<"champion" | "scout" | "tactician" | "mage", { wealth: number; unity: number }> = {
  champion: { wealth: 150, unity: 10 },
  scout: { wealth: 110, unity: 7 },
  tactician: { wealth: 130, unity: 9 },
  mage: { wealth: 140, unity: 8 },
};

function getOpeningBuildAffordability(ps: PlayerState, buildingKind: BuildingKind, level: number): { ok: boolean; shortfall: string } {
  const base = OPENING_BUILD_BASE_COSTS[buildingKind];
  if (!base) return { ok: true, shortfall: "" };
  const scale = 1 + (Math.max(1, level) - 1) * 0.4;
  const cost = {
    materials: Math.round(base.materials * scale),
    wealth: Math.round(base.wealth * scale),
    mana: base.mana != null ? Math.round(base.mana * scale) : 0,
  };
  const missing: string[] = [];
  if ((ps.resources.materials ?? 0) < cost.materials) missing.push(`${cost.materials - (ps.resources.materials ?? 0)} materials`);
  if ((ps.resources.wealth ?? 0) < cost.wealth) missing.push(`${cost.wealth - (ps.resources.wealth ?? 0)} wealth`);
  if ((ps.resources.mana ?? 0) < cost.mana) missing.push(`${cost.mana - (ps.resources.mana ?? 0)} mana`);
  return { ok: missing.length === 0, shortfall: missing.join(', ') };
}

function getOpeningRecruitAffordability(ps: PlayerState, role: "champion" | "scout" | "tactician" | "mage"): { ok: boolean; shortfall: string } {
  const cost = OPENING_HERO_RECRUIT_COSTS[role];
  const missing: string[] = [];
  if ((ps.resources.wealth ?? 0) < cost.wealth) missing.push(`${cost.wealth - (ps.resources.wealth ?? 0)} wealth`);
  if ((ps.resources.unity ?? 0) < cost.unity) missing.push(`${cost.unity - (ps.resources.unity ?? 0)} unity`);
  return { ok: missing.length === 0, shortfall: missing.join(', ') };
}

function formatOpeningContractLabel(mission: MissionOffer): string {
  switch (mission.contractKind) {
    case "relief_convoys":
      return "Escort relief convoys";
    case "stabilize_district":
      return "Stabilize district";
    case "repair_works":
      return "Repair civic works";
    case "counter_rumors":
      return "Counter rumors";
    default:
      return mission.title;
  }
}

function scoreOpeningMission(ps: PlayerState, mission: MissionOffer, lane: "city" | "black_market"): number {
  const difficultyRank = getMissionDifficultyRank(mission.difficulty);
  const supportSeverity = mission.supportGuidance?.severity ?? 0;
  const recoveryBias = mission.contractKind ? 120 : mission.responseTags.includes("recovery") ? 40 : 0;
  const strainBoost = Number(ps.cityStress?.threatPressure ?? 0) + Number(ps.cityStress?.recoveryBurden ?? 0) + Number(ps.cityStress?.total ?? 0);
  const severeRecoveryMode = Number(ps.cityStress?.threatPressure ?? 0) >= 45 || Number(ps.cityStress?.recoveryBurden ?? 0) >= 35 || Number(ps.cityStress?.total ?? 0) >= 35;
  const laneBias = lane === "city"
    ? (mission.contractKind ? 20 : mission.responseTags.includes("recovery") || mission.responseTags.includes("defense") ? 8 : 0)
    : (mission.responseTags.includes("recon") || mission.responseTags.includes("command") ? 8 : 0);
  return difficultyRank * 20 + supportSeverity - laneBias - (severeRecoveryMode ? recoveryBias + Math.floor(strainBoost / 6) : 0);
}

function buildSettlementOpeningOperations(ps: PlayerState): SettlementOpeningOperation[] {
  const lane = ps.city.settlementLane === "black_market" ? "black_market" : "city";
  const now = new Date(ps.lastTickAt || Date.now());
  syncRecoveryContractsForState(ps, now);
  const bridgeSummary = summarizeCityMudBridge(ps);
  const bridgeConsumers = deriveCityMudConsumers(bridgeSummary);
  const consequenceConsumers = deriveWorldConsequenceConsumers(ps);
  const offers = applyMissionConsumerGuidance(
    ps.currentOffers?.length
      ? ps.currentOffers
      : generateMissionOffers({
          city: ps.city,
          heroes: ps.heroes,
          armies: ps.armies,
          regionId: ps.city.regionId as any,
          regionThreat: ps.regionWar.find((entry) => entry.regionId === ps.city.regionId)?.threat ?? 0,
          cityThreatPressure: ps.cityStress?.threatPressure,
          cityStressTotal: ps.cityStress?.total,
        }),
    bridgeSummary,
    bridgeConsumers,
    consequenceConsumers,
  );
  const firstMission = [...offers].sort((a, b) => scoreOpeningMission(ps, a, lane) - scoreOpeningMission(ps, b, lane))[0];
  const worldActions = deriveWorldConsequenceActions(ps).playerActions;
  const preferredWorldAction = lane === "black_market"
    ? worldActions.find((action) => action.lane === "black_market" && action.runtime?.executable)
      ?? worldActions.find((action) => action.lane === "black_market")
      ?? worldActions.find((action) => action.runtime?.executable)
      ?? worldActions[0]
    : worldActions.find((action) => ["economy", "regional", "faction"].includes(action.lane) && action.runtime?.executable)
      ?? worldActions.find((action) => ["economy", "regional", "faction"].includes(action.lane))
      ?? worldActions.find((action) => action.runtime?.executable)
      ?? worldActions[0];

  const farmland = ps.city.buildings.find((building) => building.kind === "farmland");
  const arcaneSpire = ps.city.buildings.find((building) => building.kind === "arcane_spire");
  const civicBackboneAffordability = farmland
    ? getOpeningBuildAffordability(ps, "farmland", (farmland.level ?? 1) + 1)
    : getOpeningBuildAffordability(ps, "farmland", 1);

  const backboneOperation: SettlementOpeningOperation = lane === "black_market"
    ? arcaneSpire
      ? {
          id: "opening_shadow_backbone",
          title: "Sharpen the shadow books",
          summary: "Upgrade the Arcane Spire so the black-market lane stops living on dirty cash alone and starts compounding knowledge throughput.",
          whyNow: "Black-market starts already front-load wealth; the early failure mode is falling behind on information and pressure control.",
          payoff: "Raises knowledge-side momentum and makes later shadow reactions less blind.",
          risk: "Ignoring the knowledge side leaves you rich enough to attract heat but too dull to steer it.",
          lane: "black_market",
          priority: "opening",
          readiness: "ready_now",
          ctaLabel: "Upgrade Arcane Spire",
          action: { kind: "upgrade_building", buildingId: arcaneSpire.id },
        }
      : {
          id: "opening_shadow_arcane_seed",
          title: "Open a discreet counting room",
          summary: "Build an Arcane Spire to turn raw shadow income into knowledge and control instead of pure opportunism.",
          whyNow: "The lane already prints dirty upside; it still needs an information spine.",
          payoff: "Adds knowledge throughput and gives the lane a less brittle early curve.",
          risk: "Shadow starts that skip the knowledge seam become reactive and easier to squeeze.",
          lane: "black_market",
          priority: "opening",
          readiness: "ready_now",
          ctaLabel: "Build Arcane Spire",
          action: { kind: "build_building", buildingKind: "arcane_spire" },
        }
    : farmland
      ? {
          id: "opening_civic_backbone",
          title: "Thicken the food spine",
          summary: "Upgrade the Farmland so the civic lane has a sturdier food-and-order base before pressure starts asking unpleasant questions.",
          whyNow: civicBackboneAffordability.ok
            ? "City starts win by stable throughput, not by pretending stability appears out of thin air."
            : `You are short on ${civicBackboneAffordability.shortfall} before the civic backbone can be thickened.`,
          payoff: "Improves the city’s food backbone and supports safer early missions.",
          risk: "If food and unity slip early, every other civic action starts costing more composure.",
          lane: "economy",
          priority: "opening",
          readiness: civicBackboneAffordability.ok ? "ready_now" : "prepare_soon",
          ctaLabel: civicBackboneAffordability.ok ? "Upgrade Farmland" : "Prep Farmland upgrade",
          action: { kind: "upgrade_building", buildingId: farmland.id },
        }
      : {
          id: "opening_civic_farmland_seed",
          title: "Plant the civic surplus",
          summary: "Build farmland first so the settlement’s civic lane starts with dependable food instead of borrowed optimism.",
          whyNow: civicBackboneAffordability.ok
            ? "The city lane’s promise is steady growth; this is where that promise stops being a slogan."
            : `You are short on ${civicBackboneAffordability.shortfall} before the food spine can be planted cleanly.`,
          payoff: "Adds a visible food backbone for the first real turns after founding.",
          risk: "Skipping the food spine makes the civic lane feel decorative instead of practical.",
          lane: "economy",
          priority: "opening",
          readiness: civicBackboneAffordability.ok ? "ready_now" : "prepare_soon",
          ctaLabel: civicBackboneAffordability.ok ? "Build Farmland" : "Prep Farmland build",
          action: { kind: "build_building", buildingKind: "farmland" },
        };

  const operations: SettlementOpeningOperation[] = [backboneOperation];

  if (firstMission) {
    const heroId = chooseBestHeroForMission(ps, firstMission);
    const armyId = chooseBestArmyForMission(ps, firstMission);
    operations.push({
      id: `opening_mission_${firstMission.id}`,
      title: lane === "black_market" ? "Push the first shadow run" : "Run the first civic sortie",
      summary: `${formatOpeningContractLabel(firstMission)}. ${firstMission.supportGuidance?.headline ?? "Mission lanes are open."}`,
      whyNow: lane === "black_market"
        ? "Shadow settlements need an early payoff before pressure turns from transactional to coercive."
        : "City starts need a visible early success so the civic lane feels like action, not décor.",
      payoff: `Immediate rewards: ${Object.entries(firstMission.expectedRewards).filter(([, value]) => Number(value ?? 0) > 0).map(([key, value]) => `${key} +${value}`).join(", ") || "mission progress"}.`,
      risk: firstMission.risk.notes ?? "Mission drag is real if you overcommit the wrong force.",
      lane: firstMission.kind === "army" ? "regional" : "economy",
      priority: "opening",
      readiness: heroId || armyId ? "ready_now" : "prepare_soon",
      ctaLabel: firstMission.kind === "army" ? "Launch army mission" : "Launch hero mission",
      action: {
        kind: "start_mission",
        missionId: firstMission.id,
        heroId,
        armyId,
        responsePosture: lane === "black_market" ? "aggressive" : "balanced",
      },
    });
  }

  const recruitRole = lane === "black_market" ? "scout" : "tactician";
  const recruitAffordability = getOpeningRecruitAffordability(ps, recruitRole);
  const recruitOperation: SettlementOpeningOperation = {
    id: lane === "black_market" ? "opening_shadow_recruit" : "opening_civic_recruit",
    title: lane === "black_market" ? "Buy another pair of quiet eyes" : "Add another steady hand",
    summary: lane === "black_market"
      ? "Recruit a scout so the settlement can see pressure before it is forced to pay for it."
      : "Recruit a tactician so the civic lane gets better at orderly response instead of improvising under strain.",
    whyNow: recruitAffordability.ok
      ? "The starter roster is useful, but the first bounded expansion should still feel like a choice you can make right away."
      : `You need ${recruitAffordability.shortfall} first before staffing expands cleanly.`,
    payoff: "Gives the early loop one more concrete lever without reopening a whole subsystem family.",
    risk: "Overinvesting in staffing before acting on the board can leave resources sitting still.",
    lane: lane === "black_market" ? "black_market" : "economy",
    priority: "watch",
    readiness: recruitAffordability.ok ? "ready_now" : "prepare_soon",
    ctaLabel: recruitAffordability.ok ? (lane === "black_market" ? "Recruit scout" : "Recruit tactician") : (lane === "black_market" ? "Prep scout hire" : "Prep tactician hire"),
    action: { kind: "recruit_hero", role: recruitRole },
  };

  const shouldPreferRecruitFallback = backboneOperation.readiness !== "ready_now" || !preferredWorldAction?.runtime?.executable;
  if (shouldPreferRecruitFallback) {
    operations.push(recruitOperation);
  }

  if (preferredWorldAction && preferredWorldAction.runtime?.executable && operations.length < 3) {
    operations.push({
      id: `opening_world_${preferredWorldAction.id}`,
      title: preferredWorldAction.title,
      summary: preferredWorldAction.summary,
      whyNow: lane === "black_market"
        ? "This is the fastest route from shadow posture into an actual world-facing consequence seam."
        : "This is where civic posture turns into a public result instead of remaining an internal mood board.",
      payoff: "Ready now: this can immediately change pressure, recovery, or regional posture.",
      risk: preferredWorldAction.recommendedMoves?.[0] ?? "Unanswered spillover will keep compounding in the background.",
      lane: preferredWorldAction.lane,
      priority: preferredWorldAction.priority === "critical" ? "opening" : preferredWorldAction.priority === "high" ? "high" : "watch",
      readiness: "ready_now",
      ctaLabel: "Execute world action",
      action: { kind: "execute_world_action", actionId: preferredWorldAction.id },
    });
  }

  if (operations.length < 3) {
    operations.push(recruitOperation);
  }

  return operations.slice(0, 3);
}

function emptyResources() {
  return { food: 0, materials: 0, wealth: 0, mana: 0, knowledge: 0, unity: 0 };
}

export function buildCitySummary(ps: PlayerState) {
  const production = getCityProductionPerTick(ps.city);
  const buildingProduction = ps.city.buildings.reduce((acc, b) => {
    const p = getBuildingProductionPerTick(b);
    if (p.food) acc.foodPerTick += p.food;
    if (p.materials) acc.materialsPerTick += p.materials;
    if (p.wealth) acc.wealthPerTick += p.wealth;
    if (p.mana) acc.manaPerTick += p.mana;
    if (p.knowledge) acc.knowledgePerTick += p.knowledge;
    if (p.unity) acc.unityPerTick += p.unity;
    return acc;
  }, { foodPerTick: 0, materialsPerTick: 0, wealthPerTick: 0, manaPerTick: 0, knowledgePerTick: 0, unityPerTick: 0 });
  const laneModifier = getSettlementLaneProductionModifier(ps.city);
  const settlementLaneProduction = {
    foodPerTick: laneModifier.food ?? 0,
    materialsPerTick: laneModifier.materials ?? 0,
    wealthPerTick: laneModifier.wealth ?? 0,
    manaPerTick: laneModifier.mana ?? 0,
    knowledgePerTick: laneModifier.knowledge ?? 0,
    unityPerTick: laneModifier.unity ?? 0,
  };
  return {
    id: ps.city.id,
    name: ps.city.name,
    shardId: ps.city.shardId,
    regionId: ps.city.regionId,
    settlementLane: ps.city.settlementLane ?? "city",
    settlementLaneProfile: buildSettlementLaneProfile(ps.city.settlementLane === "black_market" ? "black_market" : "city"),
    settlementLaneReceipt: buildSettlementLaneFoundingReceipt(ps.city.settlementLane === "black_market" ? "black_market" : "city"),
    settlementLaneLatestReceipt: buildSettlementLaneLatestReceipt(ps),
    settlementLaneNextActionHint: buildSettlementLaneNextActionHint(ps),
    settlementOpeningOperations: buildSettlementOpeningOperations(ps),
    tier: ps.city.tier,
    maxBuildingSlots: ps.city.maxBuildingSlots,
    stats: ps.city.stats,
    buildings: ps.city.buildings,
    specializationId: ps.city.specializationId ?? null,
    specializationStars: ps.city.specializationStars ?? 0,
    specializationStarsHistory: ps.city.specializationStarsHistory ?? {},
    buildingSlotsUsed: ps.city.buildings.length,
    buildingSlotsMax: maxBuildingSlotsForTier(ps.city.tier),
    production: {
      foodPerTick: production.food ?? 0,
      materialsPerTick: production.materials ?? 0,
      wealthPerTick: production.wealth ?? 0,
      manaPerTick: production.mana ?? 0,
      knowledgePerTick: production.knowledge ?? 0,
      unityPerTick: production.unity ?? 0,
    },
    productionBreakdown: {
      buildings: buildingProduction,
      settlementLane: settlementLaneProduction,
    },
  };
}

function buildMePayload(viewer: Awaited<ReturnType<typeof resolveViewer>>, ps: PlayerState | null) {
  if (!ps) {
    return {
      ok: true,
      isDemo: viewer.isDemo,
      userId: viewer.userId,
      username: viewer.username,
      city: null,
      hasCity: false,
      canCreateCity: viewer.isAuthenticated,
      suggestedCityName: viewer.isAuthenticated ? suggestCityName(viewer.username) : undefined,
      citySetupChoices: viewer.isAuthenticated ? [
        buildSettlementLaneChoice("city"),
        buildSettlementLaneChoice("black_market"),
      ] : [],
      resources: emptyResources(),
      policies: { ...defaultPolicies },
      heroes: [],
      armies: [],
      activeMissions: [],
      threatWarnings: [],
      motherBrainPressureMap: [],
      missionReceipts: [],
      cityAlphaStatus: null,
      cityAlphaScopeLock: null,
      researchedTechIds: [],
      availableTechs: [],
      activeResearch: null,
      regionWar: [],
      events: [],
      workshopJobs: [],
      cityStress: null,
      specializationId: null,
      specializationStars: 0,
      specializationStarsHistory: {},
      publicInfrastructure: null,
      worldConsequences: [],
      worldConsequenceState: null,
      worldConsequenceHooks: null,
      worldConsequenceActions: null,
      worldConsequenceResponseReceipts: null,
      worldConsequenceConsumers: null,
      economyCartelResponseState: null,
    };
  }

  tickPlayerState(ps, new Date());
  const availableTechs = getAvailableTechsForPlayer(ps, {
    currentAge: ps.techAge,
    currentEpoch: ps.techEpoch,
    enabledFlags: ps.techFlags,
    categoryAges: ps.techCategoryAges,
  }).map((tech) => ({ id: tech.id, name: tech.name, description: tech.description, category: tech.category, cost: tech.cost }));

  const activeResearch = ps.activeResearch
    ? (() => {
        const tech = getTechById(ps.activeResearch!.techId);
        return {
          techId: ps.activeResearch!.techId,
          name: tech?.name ?? ps.activeResearch!.techId,
          description: tech?.description ?? "",
          category: tech?.category ?? "infrastructure",
          cost: tech?.cost ?? 0,
          progress: ps.activeResearch!.progress,
        };
      })()
    : null;

  return {
    ok: true,
    isDemo: viewer.isDemo,
    userId: viewer.userId,
    username: viewer.username,
    city: buildCitySummary(ps),
    hasCity: true,
    canCreateCity: false,
    suggestedCityName: undefined,
    citySetupChoices: [],
    resources: ps.resources,
    policies: ps.policies,
    heroes: ps.heroes,
    armies: ps.armies,
    activeMissions: ps.activeMissions,
    threatWarnings: ps.threatWarnings ?? [],
    motherBrainPressureMap: ps.motherBrainPressureMap ?? [],
    missionReceipts: ps.missionReceipts ?? [],
    cityAlphaStatus: summarizeCityAlphaStatus(ps),
    cityAlphaScopeLock: summarizeCityAlphaScopeLock(ps),
    researchedTechIds: ps.researchedTechIds,
    availableTechs,
    activeResearch,
    regionWar: ps.regionWar,
    events: ps.eventLog,
    workshopJobs: ps.workshopJobs,
    cityStress: ps.cityStress,
    specializationId: ps.city.specializationId ?? null,
    specializationStars: ps.city.specializationStars ?? 0,
    specializationStarsHistory: ps.city.specializationStarsHistory ?? {},
    publicInfrastructure: ps.publicInfrastructure,
    worldConsequences: ps.worldConsequences ?? [],
    worldConsequenceState: ps.worldConsequenceState ?? null,
    worldConsequenceHooks: deriveWorldConsequenceHooks(ps),
    worldConsequenceActions: deriveWorldConsequenceActions(ps),
    worldConsequenceResponseReceipts: summarizeWorldConsequenceResponseReceipts(ps.worldConsequences ?? []),
    worldConsequenceConsumers: deriveWorldConsequenceConsumers(ps),
    economyCartelResponseState: deriveEconomyCartelResponseState(ps),
  };
}

router.get("/", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json(buildMePayload(access.viewer, null));
  }

  const mutation = await withPlayerAccessMutation(req, (access) => buildMePayload(access.viewer, access.playerState), { requireCity: false });
  if (mutation.ok === false) {
    return res.json(buildMePayload(mutation.viewer, null));
  }
  return res.json(mutation.value);
});

export default router;
