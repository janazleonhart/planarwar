//web-backend/routes/me.ts

import { Router } from "express";

import { defaultPolicies, summarizeCityAlphaScopeLock, summarizeCityAlphaStatus, tickPlayerState, type PlayerState } from "../gameState";
import { getAvailableTechsForPlayer, getTechById } from "../domain/tech";
import { deriveWorldConsequenceHooks } from "../domain/worldConsequenceHooks";
import { deriveWorldConsequenceActions } from "../domain/worldConsequenceActions";
import { getSettlementLanePreferredActionOrder } from "../domain/worldConsequenceActions";
import { summarizeWorldConsequenceResponseReceipts } from "../domain/worldConsequences";
import { deriveWorldConsequenceConsumers } from "../domain/worldConsequenceConsumers";
import { deriveEconomyCartelResponseState } from "../domain/economyCartelResponse";
import { getBuildingProductionPerTick, getCityProductionPerTick, getSettlementLaneProductionModifier, maxBuildingSlotsForTier } from "../domain/city";
import { resolvePlayerAccess, resolveViewer, suggestCityName, withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

export type SettlementLaneResponseFocus = {
  preferredActionLanes: string[];
  advisoryTone: string;
  recommendedOpening: string;
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
    },
  };
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
