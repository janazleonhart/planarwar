//web-backend/routes/me.ts

import { Router } from "express";

import { defaultPolicies, tickPlayerState, type PlayerState } from "../gameState";
import { getAvailableTechsForPlayer, getTechById } from "../domain/tech";
import { getCityProductionPerTick, maxBuildingSlotsForTier } from "../domain/city";
import { persistPlayerStateForCity, resolvePlayerAccess, resolveViewer, suggestCityName } from "./playerCityAccess";

const router = Router();

function emptyResources() {
  return {
    food: 0,
    materials: 0,
    wealth: 0,
    mana: 0,
    knowledge: 0,
    unity: 0,
  };
}

function buildCitySummary(ps: PlayerState) {
  const production = getCityProductionPerTick(ps.city);
  return {
    id: ps.city.id,
    name: ps.city.name,
    shardId: ps.city.shardId,
    regionId: ps.city.regionId,
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
      resources: emptyResources(),
      policies: { ...defaultPolicies },
      heroes: [],
      armies: [],
      activeMissions: [],
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
    };
  }

  tickPlayerState(ps, new Date());
  const availableTechs = getAvailableTechsForPlayer(ps, {
    currentAge: ps.techAge,
    currentEpoch: ps.techEpoch,
    enabledFlags: ps.techFlags,
    categoryAges: ps.techCategoryAges,
  }).map((tech) => ({
    id: tech.id,
    name: tech.name,
    description: tech.description,
    category: tech.category,
    cost: tech.cost,
  }));

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
    resources: ps.resources,
    policies: ps.policies,
    heroes: ps.heroes,
    armies: ps.armies,
    activeMissions: ps.activeMissions,
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
  };
}

router.get("/", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    if (access.viewer.isAuthenticated && access.error === "no_city") {
      return res.json(buildMePayload(access.viewer, null));
    }
    return res.json(buildMePayload(access.viewer, null));
  }

  const payload = buildMePayload(access.access.viewer, access.access.playerState);
  await persistPlayerStateForCity(access.access);
  return res.json(payload);
});

export default router;
