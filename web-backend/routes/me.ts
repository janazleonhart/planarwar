//backend/src/routes/me.ts

import { Router } from "express";
import { getDemoPlayerWithOffers, tickConfig, xpToNextLevel, } from "../gameState";
import {
  getAvailableTechsForPlayer,
  getTechById,
} from "../domain/tech";
import { getCityProductionPerTick } from "../domain/city";

const router = Router();

router.get("/", (_req, res) => {
  const ps = getDemoPlayerWithOffers();

  const availableTechs = getAvailableTechsForPlayer(ps, {
    currentAge: ps.techAge,
    currentEpoch: ps.techEpoch,
    categoryAges: ps.techCategoryAges,
    enabledFlags: ps.techFlags,
  });

  const prod = getCityProductionPerTick(ps.city);

  const city = ps.city;
  const citySummary = {
    id: city.id,
    name: city.name,
    shardId: city.shardId,
    regionId: city.regionId,
    tier: city.tier,
    maxBuildingSlots: city.maxBuildingSlots,
    stats: city.stats,
    // derived slots
    buildingSlotsUsed: city.buildings.length,
    buildingSlotsMax: city.maxBuildingSlots,
    buildings: city.buildings,
    // per-tick production, with 0 defaults
    production: {
      foodPerTick: prod.food ?? 0,
      materialsPerTick: prod.materials ?? 0,
      wealthPerTick: prod.wealth ?? 0,
      manaPerTick: prod.mana ?? 0,
      knowledgePerTick: prod.knowledge ?? 0,
      unityPerTick: prod.unity ?? 0,
    },
    // 🔹 NEW: specialization info
    specializationId: city.specializationId ?? null,
    specializationStars: city.specializationStars ?? 0,
    specializationStarsHistory: city.specializationStarsHistory ?? {},
  };

  // research view for the client
  let activeResearchView: any = null;
  if (ps.activeResearch) {
    const tech = getTechById(ps.activeResearch.techId);
    if (tech) {
      activeResearchView = {
        techId: tech.id,
        name: tech.name,
        description: tech.description,
        category: tech.category,
        cost: tech.cost,
        progress: ps.activeResearch.progress,
      };
    }
  }

  // hero xp/level view for the client
  const heroesView = ps.heroes.map((h) => {
    const anyHero = h as any;
    const level = anyHero.level ?? 1;
    const xp = anyHero.xp ?? 0;
    const attachments = (anyHero.attachments ?? []) as any[];

    return {
      ...h,
      level,
      xp,
      xpToNext: xpToNextLevel(level),
      attachments,
    };
  });

  // Event View Log
  const eventsView = ps.eventLog.slice(-30).reverse();

  // Workshop Jobs
  const workshopJobsView = ps.workshopJobs;

  // City Stress
  const cityStress = ps.cityStress;

  res.json({
    id: ps.playerId,
    displayName: "Demo Commander",
    faction: "Tempest",
    rank: "Warden",

    lastLoginAt: ps.lastTickAt,
    lastTickAt: ps.lastTickAt,
    tickMs: tickConfig.tickMs,

    playerId: ps.playerId,
    city: citySummary,

    missions: ps.currentOffers,
    activeMissions: ps.activeMissions,

    resources: ps.resources,
    policies: ps.policies,
    heroes: heroesView,
    armies: ps.armies,

    researchedTechIds: ps.researchedTechIds,
    availableTechs: availableTechs.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      cost: t.cost,
    })),
    activeResearch: activeResearchView,

    // warfront info from gameState
    regionWar: ps.regionWar,

    // operations log
    events: eventsView,

    // workshop view
    workshopJobs: workshopJobsView,

    // city stress
    cityStress: ps.cityStress,

    // tier production
    resourceTiers: ps.resourceTiers
  });
});

export default router;
