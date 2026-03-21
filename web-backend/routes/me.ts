//web-backend/routes/me.ts

import { Router } from "express";

import { defaultPolicies, summarizeCityAlphaScopeLock, summarizeCityAlphaStatus, tickPlayerState, type PlayerState } from "../gameState";
import { getAvailableTechsForPlayer, getTechById } from "../domain/tech";
import { deriveWorldConsequenceHooks } from "../domain/worldConsequenceHooks";
import { deriveWorldConsequenceActions } from "../domain/worldConsequenceActions";
import { summarizeWorldConsequenceResponseReceipts } from "../domain/worldConsequences";
import { deriveWorldConsequenceConsumers } from "../domain/worldConsequenceConsumers";
import { deriveEconomyCartelResponseState } from "../domain/economyCartelResponse";
import { getCityProductionPerTick, maxBuildingSlotsForTier } from "../domain/city";
import { resolvePlayerAccess, resolveViewer, suggestCityName, withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

export type SettlementLaneProfile = {
  id: "city" | "black_market";
  label: string;
  summary: string;
  posture: string;
  strengths: string[];
  liabilities: string[];
};

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
      ],
      liabilities: [
        "Opens with lower security, stability, and civic unity",
        "Carries a strained early posture instead of a clean civic start",
        "Shadow gains are stronger, but legitimacy and trust cost more",
      ],
    };
  }

  return {
    id: "city",
    label: "City",
    summary: "Orderly civic settlement with public desks, visible administration, and steadier formal development.",
    posture: "steady growth, cleaner legitimacy, slower shadow upside",
    strengths: [
      "Starts from the standard civic baseline",
      "Built for overt administration, public infrastructure, and stable growth",
      "Keeps illicit pressure as outside pressure instead of a native lane",
    ],
    liabilities: [
      "Shadow-economy openings stay indirect unless you later pivot design",
      "Less front-loaded dirty profit than a black-market start",
      "Relies more on formal growth than deniable leverage",
    ],
  };
}


function emptyResources() {
  return { food: 0, materials: 0, wealth: 0, mana: 0, knowledge: 0, unity: 0 };
}

function buildCitySummary(ps: PlayerState) {
  const production = getCityProductionPerTick(ps.city);
  return {
    id: ps.city.id,
    name: ps.city.name,
    shardId: ps.city.shardId,
    regionId: ps.city.regionId,
    settlementLane: ps.city.settlementLane ?? "city",
    settlementLaneProfile: buildSettlementLaneProfile(ps.city.settlementLane === "black_market" ? "black_market" : "city"),
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
        buildSettlementLaneProfile("city"),
        buildSettlementLaneProfile("black_market"),
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
