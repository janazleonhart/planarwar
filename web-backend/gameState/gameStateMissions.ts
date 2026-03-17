//web-backend/gameState/gameStateMissions.ts

import { generateMissionOffers } from "../domain/missions";
import { missionDurationConfig } from "../config";

import type { Army } from "../domain/armies";
import type { Hero, HeroResponseRole, HeroTrait } from "../domain/heroes";
import type { MissionDifficulty, MissionOffer, MissionResponseTag, RewardBundle } from "../domain/missions";
import type { RegionId, World } from "../domain/world";
import type {
  ActiveMission,
  GameEventInput,
  PlayerState,
  Resources,
} from "../gameState";

export interface WarfrontAssaultResult {
  status: "ok" | "not_found" | "no_region" | "no_forces";
  message?: string;
  activeMission?: ActiveMission;
}

export interface GarrisonStrikeResult {
  status: "ok" | "not_found" | "no_region" | "no_hero";
  message?: string;
  activeMission?: ActiveMission;
}

export type MissionOutcomeKind = "success" | "partial" | "failure";

export interface MissionOutcome {
  kind: MissionOutcomeKind;
  successChance: number;
  roll: number;
  casualtyRate: number;
  heroInjury?: "none" | "light" | "severe";
}

export interface CompleteMissionResult {
  status: "ok" | "not_found" | "not_ready";
  message?: string;
  rewards?: RewardBundle;
  resources?: Resources;
  outcome?: MissionOutcome;
}

export interface MissionStateDeps {
  gameState: { world: World };
  getPlayerState(playerId: string): PlayerState | undefined;
  tickPlayerState(ps: PlayerState, now: Date): void;
  pushEvent(ps: PlayerState, input: GameEventInput): void;
  applyRewards(ps: PlayerState, rewards: RewardBundle): void;
}

function durationMinutesForDifficulty(diff: MissionDifficulty): number {
  const cfg = missionDurationConfig;
  switch (diff) {
    case "low":
      return cfg.low;
    case "medium":
      return cfg.medium;
    case "high":
      return cfg.high;
    case "extreme":
      return cfg.extreme;
    default:
      return cfg.medium;
  }
}

function getHeroAttachmentKinds(hero: Hero): string[] {
  return (hero.attachments ?? []).map((entry) => String(entry.kind ?? "")).filter(Boolean);
}

function getMissionResponseTags(mission: MissionOffer): MissionResponseTag[] {
  return Array.isArray(mission.responseTags) ? mission.responseTags : [];
}

function scoreHeroForMission(hero: Hero, mission: MissionOffer): number {
  const tags = getMissionResponseTags(mission);
  let score = hero.power;
  for (const role of hero.responseRoles ?? []) {
    if (tags.includes(role)) score += 18;
  }
  for (const trait of hero.traits ?? []) {
    for (const [role, delta] of Object.entries(trait.responseBias ?? {})) {
      if (tags.includes(role as HeroResponseRole)) score += Number(delta ?? 0);
    }
  }
  const attachments = getHeroAttachmentKinds(hero);
  if (attachments.includes("scouting_cloak") && tags.includes("recon")) score += 12;
  if (attachments.includes("valor_charm") && tags.includes("frontline")) score += 12;
  if (attachments.includes("arcane_focus") && tags.includes("warding")) score += 12;
  if ((hero.tags ?? []).includes("wounded")) score -= 14;
  return score;
}

function pickHeroForMission(ps: PlayerState, mission: MissionOffer, preferredHeroId?: string): Hero | null {
  const idle = ps.heroes.filter((h) => h.status === "idle");
  if (idle.length === 0) return null;
  if (preferredHeroId) {
    const exact = idle.find((hero) => hero.id === preferredHeroId);
    if (exact) return exact;
  }
  idle.sort((a, b) => scoreHeroForMission(b, mission) - scoreHeroForMission(a, mission) || b.power - a.power);
  return idle[0];
}

function pickArmyForMission(ps: PlayerState): Army | null {
  const idle = ps.armies.filter((a) => a.status === "idle");
  if (idle.length === 0) return null;
  idle.sort((a, b) => b.power - a.power);
  return idle[0];
}

function ensureOffers(ps: PlayerState): void {
  if (!ps.currentOffers || ps.currentOffers.length === 0) {
    ps.currentOffers = generateMissionOffers({
      city: ps.city,
      heroes: ps.heroes,
      armies: ps.armies,
      regionId: ps.city.regionId,
    });
  }
}

export function startMissionForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  missionId: string,
  now: Date,
  preferredHeroId?: string
): ActiveMission | null {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return null;

  deps.tickPlayerState(ps, now);
  ensureOffers(ps);

  const mission = ps.currentOffers.find((m) => m.id === missionId);
  if (!mission) return null;

  let assignedHeroId: string | undefined;
  let assignedArmyId: string | undefined;

  if (mission.kind === "hero") {
    const hero = pickHeroForMission(ps, mission, preferredHeroId);
    if (!hero) return null;
    hero.status = "on_mission";
    hero.currentMissionId = missionId;
    assignedHeroId = hero.id;
  } else if (mission.kind === "army") {
    const army = pickArmyForMission(ps);
    if (!army) return null;
    army.status = "on_mission";
    army.currentMissionId = missionId;
    assignedArmyId = army.id;
  }

  const startedAt = now.toISOString();
  const minutes = durationMinutesForDifficulty(mission.difficulty);
  const finishesAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();

  const instanceId = `active_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const active: ActiveMission = {
    instanceId,
    mission,
    startedAt,
    finishesAt,
    assignedHeroId,
    assignedArmyId,
  };

  ps.activeMissions.push(active);

  deps.pushEvent(ps, {
    kind: "mission_start",
    message: `Mission started: ${mission.title}`,
    missionId: mission.id,
    heroId: assignedHeroId,
    armyId: assignedArmyId,
    regionId: mission.regionId as RegionId,
  });

  return active;
}

export function regenerateRegionMissionsForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  targetRegionId: RegionId,
  now: Date
): MissionOffer[] | null {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return null;

  deps.tickPlayerState(ps, now);

  const remaining = ps.currentOffers.filter((m) => m.regionId !== targetRegionId);
  const newOffers = generateMissionOffers({
    city: ps.city,
    heroes: ps.heroes,
    armies: ps.armies,
    regionId: targetRegionId,
  });

  ps.currentOffers = [...remaining, ...newOffers];

  deps.pushEvent(ps, {
    kind: "mission_refresh_region",
    message: `Operations refreshed in ${targetRegionId}`,
  });

  return newOffers;
}

function difficultyFromDanger(dangerLevel: number, threat: number): MissionDifficulty {
  const score = dangerLevel * 10 + threat * 0.5;
  if (score < 40) return "low";
  if (score < 80) return "medium";
  if (score < 130) return "high";
  return "extreme";
}

export function startWarfrontAssaultForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  regionId: RegionId,
  now: Date
): WarfrontAssaultResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return { status: "not_found", message: "Player not found" };

  const shard = deps.gameState.world.shards[0];
  if (!shard) return { status: "no_region", message: "World shard missing" };

  const region = shard.regions.find((r) => r.id === regionId);
  if (!region) return { status: "no_region", message: "Region not found" };

  const rw = ps.regionWar.find((r) => r.regionId === regionId);
  if (!rw) return { status: "no_region", message: "No warfront state for that region" };

  deps.tickPlayerState(ps, now);

  const difficulty = difficultyFromDanger(region.dangerLevel, rw.threat);
  const minutes = durationMinutesForDifficulty(difficulty);
  const recommendedPower = region.dangerLevel * 120 + Math.round(rw.threat * 2);
  const missionId = `warfront_${region.id}_${Date.now()}`;

  const offer: MissionOffer = {
    id: missionId,
    kind: "army",
    difficulty,
    title: `Frontline Assault: ${region.name}`,
    description: `Commit forces to push back hostile presence in ${region.name}.`,
    regionId: region.id,
    recommendedPower,
    expectedRewards: {
      materials: 40 + region.dangerLevel * 20,
      wealth: 30 + region.dangerLevel * 15,
      influence: 2 + Math.floor(region.dangerLevel * 1.5),
    },
    risk: {
      casualtyRisk:
        difficulty === "low"
          ? "Low"
          : difficulty === "medium"
          ? "Moderate"
          : difficulty === "high"
          ? "Severe"
          : "Catastrophic",
      notes:
        "Assaulting a fortified warfront. Casualties scale with enemy threat and your army strength.",
    },
    responseTags: ["frontline", "command"],
  };

  const army = pickArmyForMission(ps);
  if (!army) {
    return { status: "no_forces", message: "No idle armies available to assault this region." };
  }

  army.status = "on_mission";
  army.currentMissionId = missionId;

  const startedAt = now.toISOString();
  const finishesAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
  const instanceId = `active_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const active: ActiveMission = {
    instanceId,
    mission: offer,
    startedAt,
    finishesAt,
    assignedArmyId: army.id,
  };

  ps.activeMissions.push(active);

  deps.pushEvent(ps, {
    kind: "mission_start",
    message: `Warfront assault launched at ${region.name}`,
    missionId: offer.id,
    armyId: army.id,
    regionId: region.id,
  });

  return { status: "ok", activeMission: active };
}

export function startGarrisonStrikeForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  regionId: RegionId,
  now: Date
): GarrisonStrikeResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return { status: "not_found", message: "Player not found" };

  const shard = deps.gameState.world.shards[0];
  if (!shard) return { status: "no_region", message: "World shard missing" };

  const region = shard.regions.find((r) => r.id === regionId);
  if (!region) return { status: "no_region", message: "Region not found" };

  const rw = ps.regionWar.find((r) => r.regionId === regionId);
  if (!rw) return { status: "no_region", message: "No warfront state for that region" };

  deps.tickPlayerState(ps, now);

  const difficulty = difficultyFromDanger(region.dangerLevel, rw.threat);
  const minutes = durationMinutesForDifficulty(difficulty);
  const recommendedPower = region.dangerLevel * 80 + Math.round(rw.threat * 1.5);
  const missionId = `garrison_${region.id}_${Date.now()}`;

  const offer: MissionOffer = {
    id: missionId,
    kind: "hero",
    difficulty,
    title: `Lair Strike: ${region.name}`,
    description:
      "Dispatch a hero-led strike team to hit enemy lairs, caches, or lieutenants in the area.",
    regionId: region.id,
    recommendedPower,
    expectedRewards: {
      wealth: 20 + region.dangerLevel * 10,
      materials: 15 + region.dangerLevel * 8,
      mana: 5 + region.dangerLevel * 4,
      influence: 1 + Math.floor(region.dangerLevel * 0.8),
    },
    risk: {
      casualtyRisk:
        difficulty === "low"
          ? "Low"
          : difficulty === "medium"
          ? "Moderate"
          : difficulty === "high"
          ? "Severe"
          : "Catastrophic",
      heroInjuryRisk:
        difficulty === "low"
          ? "Low"
          : difficulty === "medium"
          ? "Moderate"
          : difficulty === "high"
          ? "High"
          : "Extreme",
      notes:
        "Fast-moving raid aimed at enemy lairs. High risk for lone heroes at high danger levels.",
    },
    responseTags: ["recon", "warding"],
  };

  const hero = pickHeroForMission(ps, offer);
  if (!hero) {
    return { status: "no_hero", message: "No idle heroes available for a garrison strike." };
  }

  hero.status = "on_mission";
  hero.currentMissionId = missionId;

  const startedAt = now.toISOString();
  const finishesAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
  const instanceId = `active_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const active: ActiveMission = {
    instanceId,
    mission: offer,
    startedAt,
    finishesAt,
    assignedHeroId: hero.id,
  };

  ps.activeMissions.push(active);

  deps.pushEvent(ps, {
    kind: "mission_start",
    message: `Hero raid launched in ${region.name}`,
    missionId: offer.id,
    heroId: hero.id,
    regionId: region.id,
  });

  return { status: "ok", activeMission: active };
}

function computeHeroMissionEffect(hero: Hero | undefined, mission: MissionOffer): { power: number; successBonus: number; injuryDelta: number; notes: string[] } {
  if (!hero) return { power: 0, successBonus: 0, injuryDelta: 0, notes: [] };
  const notes: string[] = [];
  const tags = getMissionResponseTags(mission);
  let effectivePower = hero.power;
  let successBonus = 0;
  let injuryDelta = 0;

  for (const role of hero.responseRoles ?? []) {
    if (tags.includes(role)) {
      effectivePower += 10;
      successBonus += 0.05;
      notes.push(`${role} fit`);
    }
  }

  for (const trait of hero.traits ?? []) {
    for (const [role, delta] of Object.entries(trait.responseBias ?? {})) {
      if (tags.includes(role as HeroResponseRole)) {
        const numeric = Number(delta ?? 0);
        effectivePower += numeric;
        successBonus += numeric / 400;
        if (numeric > 0) notes.push(trait.name);
      }
    }
    injuryDelta += trait.injuryDelta ?? 0;
    effectivePower += trait.powerDelta ?? 0;
  }

  const attachments = getHeroAttachmentKinds(hero);
  if (attachments.includes("scouting_cloak") && tags.includes("recon")) {
    effectivePower += 12;
    successBonus += 0.04;
    notes.push("Scouting Cloak");
  }
  if (attachments.includes("valor_charm") && tags.includes("frontline")) {
    effectivePower += 12;
    successBonus += 0.04;
    notes.push("Valor Charm");
  }
  if (attachments.includes("arcane_focus") && tags.includes("warding")) {
    effectivePower += 12;
    successBonus += 0.04;
    notes.push("Arcane Focus");
  }
  if ((hero.tags ?? []).includes("wounded")) {
    effectivePower = Math.max(5, effectivePower - 14);
    injuryDelta += 0.08;
    notes.push("wounded");
  }

  return { power: effectivePower, successBonus, injuryDelta, notes };
}

function resolveMissionOutcome(ps: PlayerState, active: ActiveMission): MissionOutcome {
  const mission = active.mission;
  const recommended = mission.recommendedPower || 0;

  let forcePower = 0;
  let heroEffect: ReturnType<typeof computeHeroMissionEffect> | null = null;
  if (mission.kind === "hero" && active.assignedHeroId) {
    const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
    heroEffect = computeHeroMissionEffect(h, mission);
    forcePower = heroEffect.power;
  } else if (mission.kind === "army" && active.assignedArmyId) {
    const a = ps.armies.find((x) => x.id === active.assignedArmyId);
    forcePower = a?.power ?? 0;
  }

  const safeRecommended = Math.max(10, recommended);
  const ratio = forcePower > 0 ? forcePower / safeRecommended : 0.5;

  let successChance = 0.4 + (ratio - 1) * 0.25;
  if (ratio >= 1.5) successChance += 0.15;
  if (ratio <= 0.5) successChance -= 0.15;
  if (heroEffect) successChance += heroEffect.successBonus;
  successChance = Math.max(0.1, Math.min(0.95, successChance));

  const roll = Math.random();

  let kind: MissionOutcomeKind;
  if (roll < successChance * 0.7) {
    kind = "success";
  } else if (roll < successChance * 1.1) {
    kind = "partial";
  } else {
    kind = "failure";
  }

  let casualtyRate: number;
  switch (kind) {
    case "success":
      casualtyRate = 0.05 + Math.random() * 0.1;
      break;
    case "partial":
      casualtyRate = 0.15 + Math.random() * 0.2;
      break;
    case "failure":
      casualtyRate = 0.35 + Math.random() * 0.4;
      break;
  }

  if (heroEffect) {
    casualtyRate = Math.max(0.03, Math.min(0.95, casualtyRate + heroEffect.injuryDelta));
  }

  let heroInjury: MissionOutcome["heroInjury"] = "none";
  if (mission.kind === "hero") {
    if (casualtyRate > 0.5) heroInjury = "severe";
    else if (casualtyRate > 0.25) heroInjury = "light";
  }

  return { kind, successChance, roll, casualtyRate, heroInjury };
}

function applyCasualtiesAndXp(ps: PlayerState, active: ActiveMission, outcome: MissionOutcome): void {
  const rate = outcome.casualtyRate;
  if (rate <= 0) return;

  if (active.assignedArmyId) {
    const a = ps.armies.find((x) => x.id === active.assignedArmyId);
    if (a) {
      const loss = Math.max(1, Math.round(a.size * rate));
      a.size = Math.max(1, a.size - loss);
      const powerMult = 1 - rate * 0.7;
      a.power = Math.max(5, Math.round(a.power * powerMult));
    }
  }

  if (active.assignedHeroId) {
    const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
    if (h) {
      if (outcome.heroInjury === "light") {
        if (!h.tags.includes("wounded")) h.tags = [...h.tags, "wounded"];
      } else if (outcome.heroInjury === "severe") {
        if (!h.tags.includes("wounded")) h.tags = [...h.tags, "wounded"];
        h.power = Math.max(10, Math.round(h.power * 0.9));
      }

      let baseXp: number;
      switch (active.mission.difficulty) {
        case "low":
          baseXp = 10;
          break;
        case "medium":
          baseXp = 20;
          break;
        case "high":
          baseXp = 35;
          break;
        case "extreme":
          baseXp = 50;
          break;
        default:
          baseXp = 20;
          break;
      }

      let mult = 1;
      switch (outcome.kind) {
        case "success":
          mult = 1.3;
          break;
        case "partial":
          mult = 1.0;
          break;
        case "failure":
          mult = 0.5;
          break;
      }

      if (baseXp > 0) {
        if (!h.level || h.level < 1) h.level = 1;
        if (!h.xpToNext || h.xpToNext < 10) h.xpToNext = 100;
        if (h.xp == null) h.xp = 0;
        h.xp += Math.round(baseXp * mult);
        while (h.xp >= h.xpToNext) {
          h.xp -= h.xpToNext;
          h.level += 1;
          h.xpToNext = Math.round(h.xpToNext * 1.25);
        }
      }
    }
  }
}

function applyMissionImpactToRegion(ps: PlayerState, mission: MissionOffer, outcome: MissionOutcome): void {
  const region = ps.regionWar.find((rw) => rw.regionId === mission.regionId);
  if (!region) return;

  let controlDelta = 0;
  let threatDelta = 0;

  switch (outcome.kind) {
    case "success":
      controlDelta = 5;
      threatDelta = -5;
      break;
    case "partial":
      controlDelta = 2;
      threatDelta = -2;
      break;
    case "failure":
      controlDelta = -3;
      threatDelta = 4;
      break;
  }

  region.control = Math.max(0, Math.min(100, region.control + controlDelta));
  region.threat = Math.max(0, Math.min(100, region.threat + threatDelta));
}

export function completeMissionForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  instanceId: string,
  now: Date
): CompleteMissionResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return { status: "not_found", message: "Player not found" };

  deps.tickPlayerState(ps, now);

  const index = ps.activeMissions.findIndex((am) => am.instanceId === instanceId);
  if (index === -1) return { status: "not_found", message: "Mission instance not found" };

  const active = ps.activeMissions[index];
  const finishTime = new Date(active.finishesAt).getTime();
  if (now.getTime() < finishTime) {
    return { status: "not_ready", message: "Mission is still in progress" };
  }

  const outcome = resolveMissionOutcome(ps, active);
  applyCasualtiesAndXp(ps, active, outcome);

  if (active.assignedHeroId) {
    const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
    if (h) {
      h.status = "idle";
      h.currentMissionId = undefined;
    }
  }
  if (active.assignedArmyId) {
    const a = ps.armies.find((x) => x.id === active.assignedArmyId);
    if (a) {
      a.status = "idle";
      a.currentMissionId = undefined;
    }
  }

  const rewards = active.mission.expectedRewards;
  deps.applyRewards(ps, rewards);
  applyMissionImpactToRegion(ps, active.mission, outcome);

  deps.pushEvent(ps, {
    kind: "mission_complete",
    message: `Mission ${active.mission.title}: ${outcome.kind.toUpperCase()}`,
    missionId: active.mission.id,
    heroId: active.assignedHeroId,
    armyId: active.assignedArmyId,
    regionId: active.mission.regionId as RegionId,
    outcome: outcome.kind,
  });

  ps.activeMissions.splice(index, 1);

  return { status: "ok", rewards, resources: ps.resources, outcome };
}
