//web-backend/gameState/gameStateEconomy.ts

import { getCityProductionPerTick, getSettlementLaneProductionModifier, type BuildingProduction } from "../domain/city";
import { addResources, type ResourceVector } from "../domain/resources";
import { getTechById, type TechDefinition } from "../domain/tech";
import { decayPublicInfrastructureHeat } from "../domain/publicInfrastructure";
import type { World } from "../domain/world";
import type {
  CityStressStage,
  GameEventInput,
  PlayerState,
} from "../gameState";

export interface GameStateEconomyDeps {
  tickMs: number;
  maxTicksPerRequest: number;
  getWorld(): World;
  clampStat(v: number): number;
  pushEvent(ps: PlayerState, input: GameEventInput): void;
  applySpecializationToProduction(ps: PlayerState["city"], base: BuildingProduction): BuildingProduction;
  applyResourceTiersToProduction(ps: PlayerState, base: BuildingProduction): BuildingProduction;
}

function recomputeCityStress(
  deps: GameStateEconomyDeps,
  ps: PlayerState,
  now: Date
): void {
  const r = ps.resources;
  const war = ps.regionWar;

  const foodPressure =
    r.food >= 100 ? 0 : Math.min(100, Math.round(((100 - r.food) / 100) * 100));

  const maxThreat = war.reduce((m, rw) => Math.max(m, rw.threat), 0);
  const threatPressure = Math.round(maxThreat);

  const unityPressure =
    r.unity >= 70 ? 0 : Math.min(100, Math.round(((70 - r.unity) / 70) * 100));

  const recoveryBurden = Math.max(0, Math.min(100, Math.round(ps.cityStress?.recoveryBurden ?? 0)));

  const totalRaw = foodPressure * 0.32 + threatPressure * 0.33 + unityPressure * 0.17 + recoveryBurden * 0.18;
  const total = Math.round(Math.min(100, totalRaw));

  let stage: CityStressStage;
  if (total < 25) stage = "stable";
  else if (total < 50) stage = "strained";
  else if (total < 75) stage = "crisis";
  else stage = "lockdown";

  const prevStage = ps.cityStress?.stage;

  ps.cityStress = {
    stage,
    total,
    foodPressure,
    threatPressure,
    unityPressure,
    recoveryBurden,
    lastUpdatedAt: now.toISOString(),
  };

  if (prevStage && prevStage !== stage) {
    let msg: string;
    switch (stage) {
      case "stable":
        msg = "City tension has eased. Streets are calmer.";
        break;
      case "strained":
        msg = "The city is growing uneasy. Grumbling and rumors spread.";
        break;
      case "crisis":
        msg =
          "Crisis in the streets: unrest is rising and discipline is fraying.";
        break;
      case "lockdown":
      default:
        msg =
          "Lockdown: riots, curfews, and crackdowns are spreading through the city.";
        break;
    }

    deps.pushEvent(ps, {
      kind: "city_stress_change",
      message: msg,
    });
  }
}

function applyProductionToResources(
  ps: PlayerState,
  prod: BuildingProduction,
  ticks: number
): void {
  const mult = ticks;
  const res = ps.resources;

  const delta: ResourceVector = {};

  if (prod.food) {
    const v = prod.food * mult;
    res.food += v;
    delta.food = (delta.food ?? 0) + v;
  }
  if (prod.materials) {
    const v = prod.materials * mult;
    res.materials += v;
    delta.materials_generic = (delta.materials_generic ?? 0) + v;
  }
  if (prod.wealth) {
    const v = prod.wealth * mult;
    res.wealth += v;
    delta.wealth = (delta.wealth ?? 0) + v;
  }
  if (prod.mana) {
    const v = prod.mana * mult;
    res.mana += v;
    delta.mana_arcane = (delta.mana_arcane ?? 0) + v;
  }
  if (prod.knowledge) {
    const v = prod.knowledge * mult;
    res.knowledge += v;
    delta.knowledge = (delta.knowledge ?? 0) + v;
  }
  if (prod.unity) {
    const v = prod.unity * mult;
    res.unity += v;
    delta.unity = (delta.unity ?? 0) + v;
  }

  if (Object.keys(delta).length > 0) {
    ps.stockpile = addResources(ps.stockpile, delta);
  }
}

function applyPolicyTickEffects(
  deps: GameStateEconomyDeps,
  ps: PlayerState,
  prod: BuildingProduction,
  ticks: number
): void {
  const p = ps.policies;
  const s = ps.city.stats;
  const r = ps.resources;
  const mult = ticks;

  const wealthBase = prod.wealth ?? 0;
  const manaBase = prod.mana ?? 0;

  if (p.highTaxes) {
    r.wealth += Math.round(wealthBase * 0.5 * mult);
    s.stability = deps.clampStat(s.stability - 0.2 * mult);
  }

  if (p.openTrade) {
    r.wealth += Math.round(wealthBase * 0.25 * mult);
    s.prosperity = deps.clampStat(s.prosperity + 0.15 * mult);
  }

  if (p.conscription) {
    s.security = deps.clampStat(s.security + 0.2 * mult);
    s.unity = deps.clampStat(s.unity - 0.1 * mult);
  }

  if (p.arcaneFreedom) {
    r.mana += Math.round(manaBase * 0.5 * mult);
    s.arcaneSaturation = deps.clampStat(s.arcaneSaturation + 0.2 * mult);
    s.stability = deps.clampStat(s.stability - 0.1 * mult);
  }
}

function applyCityGrowthAndUpkeep(
  deps: GameStateEconomyDeps,
  ps: PlayerState,
  prod: BuildingProduction,
  ticks: number
): void {
  const s = ps.city.stats;
  const r = ps.resources;

  if (ticks <= 0) return;

  const population = s.population;
  const consumptionPerTick = Math.max(0, population * 0.1);
  const totalConsumption = consumptionPerTick * ticks;

  r.food -= totalConsumption;

  if (r.food < 0) {
    const deficit = -r.food;
    r.food = 0;

    const popLoss = Math.floor(deficit / 10);
    if (popLoss > 0) {
      s.population = Math.max(10, s.population - popLoss);
    }

    s.stability = deps.clampStat(s.stability - 0.3 * ticks);
    s.prosperity = deps.clampStat(s.prosperity - 0.2 * ticks);
    s.unity = deps.clampStat(s.unity - 0.2 * ticks);
  } else {
    const foodOut = prod.food ?? 0;
    const surplusPerTick = foodOut - consumptionPerTick;

    if (surplusPerTick > 5 && s.stability > 40) {
      const growth = Math.floor((surplusPerTick / 10) * ticks);
      if (growth > 0) {
        s.population += growth;
        s.prosperity = deps.clampStat(s.prosperity + 0.1 * ticks);
      }
    }
  }
}


function emitSettlementLanePassiveReceipt(
  deps: GameStateEconomyDeps,
  ps: PlayerState,
  ticks: number
): void {
  if (ticks < 5) return;

  const laneModifier = getSettlementLaneProductionModifier(ps.city);
  let message: string | null = null;

  if (ps.city.settlementLane === "black_market") {
    const wealth = (laneModifier.wealth ?? 0) * ticks;
    const knowledge = (laneModifier.knowledge ?? 0) * ticks;
    if (wealth > 0 || knowledge > 0) {
      message = `Shadow surplus skimmed extra returns (+${wealth} wealth, +${knowledge} knowledge).`;
    }
  } else {
    const food = (laneModifier.food ?? 0) * ticks;
    const unity = (laneModifier.unity ?? 0) * ticks;
    if (food > 0 || unity > 0) {
      message = `Civic surplus kept the city steady (+${food} food, +${unity} unity).`;
    }
  }

  if (!message) return;
  if (ps.eventLog.at(-1)?.message === message) return;

  deps.pushEvent(ps, {
    kind: "city_morph",
    message,
  });
}

function applyTechCompletion(
  deps: GameStateEconomyDeps,
  ps: PlayerState,
  tech: TechDefinition
): void {
  const stats = ps.city.stats;
  const res = ps.resources;

  switch (tech.id) {
    case "urban_planning_1":
      ps.city.maxBuildingSlots += 2;
      stats.infrastructure = deps.clampStat(stats.infrastructure + 3);
      stats.prosperity = deps.clampStat(stats.prosperity + 1);
      break;
    case "urban_planning_2":
      ps.city.maxBuildingSlots += 2;
      stats.infrastructure = deps.clampStat(stats.infrastructure + 4);
      stats.prosperity = deps.clampStat(stats.prosperity + 2);
      stats.stability = deps.clampStat(stats.stability + 1);
      break;
    case "urban_planning_3":
      ps.city.maxBuildingSlots += 3;
      stats.infrastructure = deps.clampStat(stats.infrastructure + 6);
      stats.prosperity = deps.clampStat(stats.prosperity + 3);
      stats.stability = deps.clampStat(stats.stability + 2);
      break;
    case "advanced_agriculture_1":
      stats.prosperity = deps.clampStat(stats.prosperity + 2);
      stats.stability = deps.clampStat(stats.stability + 1);
      res.food += 50;
      break;
    case "advanced_agriculture_2":
      stats.prosperity = deps.clampStat(stats.prosperity + 3);
      res.food += 100;
      res.unity += 10;
      break;
    case "militia_training_1":
      stats.security = deps.clampStat(stats.security + 4);
      stats.stability = deps.clampStat(stats.stability + 1);
      break;
    case "militia_training_2":
      stats.security = deps.clampStat(stats.security + 6);
      ps.armies.forEach((a) => {
        a.power = Math.max(5, Math.round(a.power * 1.1));
      });
      break;
    default:
      break;
  }
}

function applyResearchProgress(
  deps: GameStateEconomyDeps,
  ps: PlayerState,
  prod: BuildingProduction,
  ticks: number
): void {
  if (!ps.activeResearch) return;

  const tech = getTechById(ps.activeResearch.techId);
  if (!tech) {
    ps.activeResearch = undefined;
    return;
  }

  const knowledgePerTick = prod.knowledge ?? 0;
  if (knowledgePerTick <= 0) return;

  const delta = knowledgePerTick * ticks;
  ps.activeResearch.progress += delta;

  if (ps.activeResearch.progress >= tech.cost) {
    if (!ps.researchedTechIds.includes(tech.id)) {
      ps.researchedTechIds.push(tech.id);
      applyTechCompletion(deps, ps, tech);
    }
    ps.activeResearch = undefined;
  }
}

function applyWarfrontDrift(
  deps: GameStateEconomyDeps,
  ps: PlayerState,
  ticks: number
): void {
  if (ticks <= 0) return;

  const shard = deps.getWorld().shards[0];
  if (!shard) return;

  const stats = ps.city.stats;

  for (const rw of ps.regionWar) {
    const region = shard.regions.find((r) => r.id === rw.regionId);
    if (!region) continue;

    const danger = region.dangerLevel;
    const security = stats.security;
    const stability = stats.stability;
    const defenseFactor = (security + stability) / 200;
    const baseThreatGain = danger * 0.03 * ticks;
    const threatGain = baseThreatGain * (1 - defenseFactor);

    rw.threat = deps.clampStat(rw.threat + threatGain);

    if (rw.threat > 60) {
      const over = rw.threat - 60;
      const controlLoss = over * 0.02 * ticks;
      rw.control = deps.clampStat(rw.control - controlLoss);
    }
  }
}


function applyRecoveryContractNeglect(
  deps: GameStateEconomyDeps,
  ps: PlayerState,
  ticks: number
): void {
  if (ticks <= 0) return;

  const contracts = (ps.currentOffers ?? []).filter((offer) => offer.contractKind);
  if (contracts.length === 0) return;

  const hours = Math.max(1, Math.floor(ticks / 6));
  let summary: string | null = null;

  for (const contract of contracts) {
    switch (contract.contractKind) {
      case "repair_works": {
        const infraLoss = Math.max(1, Math.floor(hours));
        const burdenGain = Math.max(1, Math.floor(hours));
        const pressureGain = Math.max(1, Math.floor(hours / 2));
        ps.city.stats.infrastructure = deps.clampStat(ps.city.stats.infrastructure - infraLoss);
        ps.cityStress.recoveryBurden = deps.clampStat((ps.cityStress.recoveryBurden ?? 0) + burdenGain);
        ps.cityStress.threatPressure = deps.clampStat((ps.cityStress.threatPressure ?? 0) + pressureGain);
        summary ??= "Neglected repair backlog is chewing through outer works and raising recovery burden.";
        break;
      }
      case "relief_convoys": {
        const foodLoss = Math.max(24, Math.floor(hours * 36));
        const burdenGain = Math.max(1, Math.floor(hours));
        const pressureGain = Math.max(1, Math.floor(hours / 2));
        ps.resources.food = Math.max(0, ps.resources.food - foodLoss);
        ps.cityStress.recoveryBurden = deps.clampStat((ps.cityStress.recoveryBurden ?? 0) + burdenGain);
        ps.cityStress.threatPressure = deps.clampStat((ps.cityStress.threatPressure ?? 0) + pressureGain);
        summary ??= "Unescorted relief lanes are bleeding supplies and sustaining city pressure.";
        break;
      }
      case "stabilize_district": {
        const stabilityLoss = Math.max(1, Math.floor(hours));
        const unityLoss = Math.max(1, Math.floor(hours * 2));
        const burdenGain = Math.max(1, Math.floor(hours));
        ps.city.stats.stability = deps.clampStat(ps.city.stats.stability - stabilityLoss);
        ps.resources.unity = Math.max(0, ps.resources.unity - unityLoss);
        ps.cityStress.recoveryBurden = deps.clampStat((ps.cityStress.recoveryBurden ?? 0) + burdenGain);
        summary ??= "Unanswered district strain is hardening into civic fatigue and deeper recovery burden.";
        break;
      }
      case "counter_rumors": {
        const securityLoss = Math.max(1, Math.floor(hours));
        const unityLoss = Math.max(1, Math.floor(hours));
        const burdenGain = Math.max(1, Math.floor(hours / 2));
        ps.city.stats.security = deps.clampStat(ps.city.stats.security - securityLoss);
        ps.city.stats.unity = deps.clampStat(ps.city.stats.unity - unityLoss);
        ps.cityStress.recoveryBurden = deps.clampStat((ps.cityStress.recoveryBurden ?? 0) + burdenGain);
        summary ??= "Rumors left unchecked are eroding order and compounding the recovery bill.";
        break;
      }
      default:
        break;
    }
  }

  if (summary && ps.eventLog.at(-1)?.message !== summary) {
    deps.pushEvent(ps, {
      kind: "city_morph",
      message: summary,
    });
  }
}

export function tickPlayerState(
  deps: GameStateEconomyDeps,
  ps: PlayerState,
  now: Date
): void {
  const last = new Date(ps.lastTickAt).getTime();
  const nowTime = now.getTime();
  const diff = nowTime - last;
  if (diff <= 0) return;

  let ticks = Math.floor(diff / deps.tickMs);
  if (ticks <= 0) return;
  if (ticks > deps.maxTicksPerRequest) {
    ticks = deps.maxTicksPerRequest;
  }

  const rawProd = getCityProductionPerTick(ps.city);
  const specProd = deps.applySpecializationToProduction(ps.city, rawProd);
  const tieredProd = deps.applyResourceTiersToProduction(ps, specProd);
  const prodPerTick = tieredProd;

  applyProductionToResources(ps, tieredProd, ticks);
  applyPolicyTickEffects(deps, ps, tieredProd, ticks);
  applyCityGrowthAndUpkeep(deps, ps, prodPerTick, ticks);
  applyWarfrontDrift(deps, ps, ticks);
  applyRecoveryContractNeglect(deps, ps, ticks);
  applyResearchProgress(deps, ps, tieredProd, ticks);

  const advancedTime = last + ticks * deps.tickMs;
  const advancedDate = new Date(advancedTime);
  ps.lastTickAt = advancedDate.toISOString();

  recomputeCityStress(deps, ps, advancedDate);
  emitSettlementLanePassiveReceipt(deps, ps, ticks);
}

