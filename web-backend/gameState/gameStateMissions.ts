//web-backend/gameState/gameStateMissions.ts

import { generateMissionOffers } from "../domain/missions";
import { missionDurationConfig } from "../config";

import type { Army, ArmyResponseRole } from "../domain/armies";
import type { Hero, HeroAttachment, HeroResponseRole, HeroTrait } from "../domain/heroes";
import { getHeroAttachmentDef } from "./gameStateHeroes";
import type { MissionDifficulty, MissionOffer, MissionResponseTag, RewardBundle, ThreatFamily, ThreatWarning, WarningIntelQuality } from "../domain/missions";
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


export interface ThreatWarningSyncResult {
  warnings: ThreatWarning[];
  intelScore: number;
  intelQuality: WarningIntelQuality;
}

export interface MissionStateDeps {
  gameState: { world: World };
  getPlayerState(playerId: string): PlayerState | undefined;
  tickPlayerState(ps: PlayerState, now: Date): void;
  pushEvent(ps: PlayerState, input: GameEventInput): void;
  applyRewards(ps: PlayerState, rewards: RewardBundle): void;
}

function computeIntelScore(ps: PlayerState): number {
  let score = 0;

  score += (ps.city.stats.security ?? 0) * 0.35;
  score += (ps.city.stats.infrastructure ?? 0) * 0.18;
  score += (ps.city.stats.arcaneSaturation ?? 0) * 0.05;

  for (const hero of ps.heroes ?? []) {
    if (hero.status !== "idle") continue;
    if (hero.role === "scout") score += 16;
    if ((hero.responseRoles ?? []).includes("recon")) score += 12;
    if ((hero.responseRoles ?? []).includes("command")) score += 5;
    for (const trait of hero.traits ?? []) {
      const reconBias = Number(trait.responseBias?.recon ?? 0);
      const commandBias = Number(trait.responseBias?.command ?? 0);
      score += reconBias * 0.35;
      score += commandBias * 0.1;
    }
    for (const attachment of getHeroAttachments(hero)) {
      if ((attachment.responseTags ?? []).includes("recon")) score += 8;
      if ((attachment.responseTags ?? []).includes("warding")) score += 4;
    }
  }

  for (const army of ps.armies ?? []) {
    if (army.status !== "idle") continue;
    if ((army.specialties ?? []).includes("recon")) score += 14;
    if ((army.specialties ?? []).includes("command")) score += 6;
    score += Math.max(0, (army.readiness ?? 0) - 50) * 0.08;
  }

  for (const techId of ps.researchedTechIds ?? []) {
    if (techId.startsWith("militia_training")) score += 5;
    if (techId.startsWith("urban_planning")) score += 4;
  }

  return Math.round(score);
}

function intelQualityFromScore(score: number): WarningIntelQuality {
  if (score >= 95) return "precise";
  if (score >= 70) return "clear";
  if (score >= 45) return "usable";
  return "faint";
}

function leadMinutesForWarning(severity: number, intelQuality: WarningIntelQuality): number {
  const base = intelQuality === "precise" ? 95 : intelQuality === "clear" ? 70 : intelQuality === "usable" ? 42 : 22;
  const severityDrag = Math.round(severity * 0.18);
  return Math.max(12, base - severityDrag);
}

function topResponseTags(mission: MissionOffer): MissionResponseTag[] {
  const tags = getMissionResponseTags(mission);
  return tags.length > 0 ? tags.slice(0, 3) : [mission.kind === "army" ? "frontline" : "recon"];
}

function threatFamilyLabel(family?: ThreatFamily): string {
  switch (family) {
    case "bandits": return "Bandits";
    case "mercs": return "Mercenaries";
    case "desperate_towns": return "Desperate towns";
    case "organized_hostile_forces": return "Organized hostile forces";
    case "early_planar_strike": return "Early planar strike";
    default: return "Hostile pressure";
  }
}

function warningHeadlineForMission(mission: MissionOffer, intelQuality: WarningIntelQuality): string {
  const prefix = intelQuality === "faint" ? "Uneasy reports" : intelQuality === "usable" ? "Field warning" : intelQuality === "clear" ? "Confirmed warning" : "Precise threat window";
  return `${prefix}: ${mission.title}`;
}

function warningDetailForMission(mission: MissionOffer, intelQuality: WarningIntelQuality, leadMinutes: number): string {
  const visibility = intelQuality === "faint"
    ? "Scattered reports suggest trouble, but the picture is incomplete."
    : intelQuality === "usable"
    ? "Scouts and stewards agree something is building."
    : intelQuality === "clear"
    ? "Multiple signals align on an approaching strike window."
    : "Scouts, command, and local watchers agree on where pressure will land.";
  const reasons = (mission.targetingReasons ?? []).slice(0, 2).join(" ");
  const familyDetail = mission.threatFamily ? `${threatFamilyLabel(mission.threatFamily)} are the likely source.` : "";
  return `${visibility} Expect impact pressure in roughly ${leadMinutes}m near ${mission.regionId}. ${familyDetail} ${mission.description} ${reasons}`.trim();
}

function warningActionForMission(mission: MissionOffer, hero: Hero | null, army: Army | null): string {
  const heroText = hero ? `${hero.name} (${(hero.responseRoles ?? []).join("/")})` : "your best idle hero";
  const armyText = army ? `${army.name} (${(army.specialties ?? []).join("/")})` : "your best idle army";
  const familyText = mission.threatFamily ? ` against ${threatFamilyLabel(mission.threatFamily).toLowerCase()}` : "";
  if (mission.kind === "hero") {
    return `Prepare ${heroText} for a ${topResponseTags(mission).join("/")} response${familyText} and keep a reserve army ready if the warning escalates.`;
  }
  return `Stage ${armyText} for a ${topResponseTags(mission).join("/")} response${familyText} and keep ${heroText} ready to plug intel or warding gaps.`;
}

export function syncThreatWarnings(ps: PlayerState, now: Date): ThreatWarningSyncResult {
  const offers = Array.isArray(ps.currentOffers) ? ps.currentOffers : [];
  const intelScore = computeIntelScore(ps);
  const intelQuality = intelQualityFromScore(intelScore);

  const prioritized = offers
    .filter((offer) => offer.difficulty !== "low" || offer.kind === "army")
    .slice()
    .sort((a, b) => {
      const severityA = (a.recommendedPower ?? 0) + (a.kind === "army" ? 40 : 15);
      const severityB = (b.recommendedPower ?? 0) + (b.kind === "army" ? 40 : 15);
      return severityB - severityA;
    })
    .slice(0, 3);

  const warnings: ThreatWarning[] = prioritized.map((mission, index) => {
    const severity = Math.max(18, Math.min(100, Math.round((mission.recommendedPower ?? 0) * 0.45 + (mission.kind === "army" ? 18 : 8))));
    const leadMinutes = leadMinutesForWarning(severity, intelQuality) + index * 8;
    const issuedAt = now.toISOString();
    const earliestImpactAt = new Date(now.getTime() + leadMinutes * 60_000).toISOString();
    const latestImpactAt = new Date(now.getTime() + (leadMinutes + 35) * 60_000).toISOString();
    const recommendedHero = pickHeroForMission(ps, mission);
    const recommendedArmy = mission.kind === "army" ? pickArmyForMission(ps, mission) : pickArmyForMission(ps, { ...mission, kind: "army" });

    return {
      id: `warn_${mission.id}`,
      missionId: mission.id,
      targetRegionId: mission.regionId,
      issuedAt,
      earliestImpactAt,
      latestImpactAt,
      severity,
      intelQuality,
      headline: warningHeadlineForMission(mission, intelQuality),
      detail: warningDetailForMission(mission, intelQuality, leadMinutes),
      responseTags: topResponseTags(mission),
      recommendedAction: warningActionForMission(mission, recommendedHero, recommendedArmy),
      recommendedHeroId: recommendedHero?.id,
      recommendedArmyId: recommendedArmy?.id,
      threatFamily: mission.threatFamily,
      targetingPressure: mission.targetingPressure,
      targetingReasons: mission.targetingReasons ? [...mission.targetingReasons] : [],
    };
  });

  ps.threatWarnings = warnings;
  return { warnings, intelScore, intelQuality };
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

function getHeroAttachments(hero: Hero): HeroAttachment[] {
  return (hero.attachments ?? []).filter((entry): entry is HeroAttachment => Boolean(entry && entry.kind));
}

function getHeroAttachmentEffects(hero: Hero, mission: MissionOffer): { power: number; successBonus: number; injuryDelta: number; notes: string[] } {
  const tags = getMissionResponseTags(mission);
  let power = 0;
  let successBonus = 0;
  let injuryDelta = 0;
  const notes: string[] = [];

  for (const attachment of getHeroAttachments(hero)) {
    const def = getHeroAttachmentDef(attachment.kind);
    const responseTags = attachment.responseTags?.length ? attachment.responseTags : def?.responseTags ?? [];
    const overlap = responseTags.filter((tag) => tags.includes(tag));
    if (overlap.length > 0) {
      power += 8 + overlap.length * 4;
      successBonus += 0.02 + overlap.length * 0.01;
      notes.push(attachment.name);
    }

    const family = attachment.family ?? def?.family;
    if (family === "martial" && hero.responseRoles.includes("frontline") && tags.includes("frontline")) {
      power += 4;
      successBonus += 0.01;
    }
    if (family === "recon" && hero.responseRoles.includes("recon") && tags.includes("recon")) {
      power += 4;
      successBonus += 0.01;
    }
    if (family === "arcane" && hero.responseRoles.includes("warding") && (tags.includes("warding") || tags.includes("command"))) {
      power += 5;
      successBonus += 0.015;
    }

    if ((attachment.slot ?? def?.slot) === "utility" && tags.includes("recon")) injuryDelta -= 0.02;
    if ((attachment.slot ?? def?.slot) === "trinket" && tags.includes("frontline")) injuryDelta -= 0.015;
    if ((attachment.slot ?? def?.slot) === "focus" && tags.includes("warding")) injuryDelta -= 0.01;
  }

  return { power, successBonus, injuryDelta, notes };
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
  score += getHeroAttachmentEffects(hero, mission).power;
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

function scoreArmyForMission(army: Army, mission: MissionOffer): number {
  const tags = getMissionResponseTags(mission);
  let score = army.power * (0.6 + army.readiness / 100);
  for (const specialty of army.specialties ?? []) {
    if (tags.includes(specialty as MissionResponseTag)) score += 16;
  }
  if (army.type === "militia" && tags.includes("defense")) score += 10;
  if (army.type === "line" && tags.includes("command")) score += 10;
  if (army.type === "vanguard" && tags.includes("recon")) score += 10;
  return score;
}

function pickArmyForMission(ps: PlayerState, mission: MissionOffer, preferredArmyId?: string): Army | null {
  const idle = ps.armies.filter((a) => a.status === "idle");
  if (idle.length === 0) return null;
  if (preferredArmyId) {
    const exact = idle.find((army) => army.id === preferredArmyId);
    if (exact) return exact;
  }
  idle.sort((a, b) => scoreArmyForMission(b, mission) - scoreArmyForMission(a, mission) || b.power - a.power);
  return idle[0];
}

function ensureOffers(ps: PlayerState): void {
  if (!ps.currentOffers || ps.currentOffers.length === 0) {
    ps.currentOffers = generateMissionOffers({
      city: ps.city,
      heroes: ps.heroes,
      armies: ps.armies,
      regionId: ps.city.regionId,
      regionThreat: ps.regionWar.find((entry) => entry.regionId === ps.city.regionId)?.threat ?? 0,
      cityThreatPressure: ps.cityStress.threatPressure ?? 0,
      cityStressTotal: ps.cityStress.total ?? 0,
    });
  }
}

export function startMissionForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  missionId: string,
  now: Date,
  preferredHeroId?: string,
  preferredArmyId?: string
): ActiveMission | null {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return null;

  deps.tickPlayerState(ps, now);
  ensureOffers(ps);

  const mission = ps.currentOffers.find((m) => m.id === missionId);
  if (!mission) return null;

  let assignedHeroId: string | undefined;
  let assignedArmyId: string | undefined;

  const familyText = mission.threatFamily ? ` against ${threatFamilyLabel(mission.threatFamily).toLowerCase()}` : "";
  if (mission.kind === "hero") {
    const hero = pickHeroForMission(ps, mission, preferredHeroId);
    if (!hero) return null;
    hero.status = "on_mission";
    hero.currentMissionId = missionId;
    assignedHeroId = hero.id;
  } else if (mission.kind === "army") {
    const army = pickArmyForMission(ps, mission, preferredArmyId);
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
    regionThreat: ps.regionWar.find((entry) => entry.regionId === targetRegionId)?.threat ?? 0,
    cityThreatPressure: ps.cityStress.threatPressure ?? 0,
    cityStressTotal: ps.cityStress.total ?? 0,
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

  const army = pickArmyForMission(ps, offer);
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

  const attachmentEffect = getHeroAttachmentEffects(hero, mission);
  effectivePower += attachmentEffect.power;
  successBonus += attachmentEffect.successBonus;
  injuryDelta += attachmentEffect.injuryDelta;
  notes.push(...attachmentEffect.notes);
  if ((hero.tags ?? []).includes("wounded")) {
    effectivePower = Math.max(5, effectivePower - 14);
    injuryDelta += 0.08;
    notes.push("wounded");
  }

  return { power: effectivePower, successBonus, injuryDelta, notes };
}

function computeArmyMissionEffect(army: Army | undefined, mission: MissionOffer): { power: number; successBonus: number; readinessDelta: number; notes: string[] } {
  if (!army) return { power: 0, successBonus: 0, readinessDelta: 0, notes: [] };
  const tags = getMissionResponseTags(mission);
  const notes: string[] = [];
  let effectivePower = army.power * (0.6 + army.readiness / 100);
  let successBonus = 0;
  let readinessDelta = 0;

  for (const specialty of army.specialties ?? []) {
    if (tags.includes(specialty as MissionResponseTag)) {
      effectivePower += 14;
      successBonus += 0.04;
      notes.push(`${specialty} fit`);
    }
  }

  if (army.type === "militia" && tags.includes("defense")) {
    effectivePower += 10;
    successBonus += 0.03;
    notes.push("militia defense doctrine");
  }
  if (army.type === "line" && tags.includes("command")) {
    effectivePower += 10;
    successBonus += 0.03;
    notes.push("line regiment discipline");
  }
  if (army.type === "vanguard" && tags.includes("recon")) {
    effectivePower += 10;
    successBonus += 0.03;
    notes.push("vanguard mobility");
  }

  if (army.readiness >= 90) {
    effectivePower += 12;
    successBonus += 0.04;
    notes.push("high readiness");
  } else if (army.readiness <= 45) {
    effectivePower -= 18;
    successBonus -= 0.06;
    readinessDelta += 0.06;
    notes.push("fatigued");
  }

  return { power: Math.max(5, Math.round(effectivePower)), successBonus, readinessDelta, notes };
}

function resolveMissionOutcome(ps: PlayerState, active: ActiveMission): MissionOutcome {
  const mission = active.mission;
  const recommended = mission.recommendedPower || 0;

  let forcePower = 0;
  let heroEffect: ReturnType<typeof computeHeroMissionEffect> | null = null;
  let armyEffect: ReturnType<typeof computeArmyMissionEffect> | null = null;
  if (mission.kind === "hero" && active.assignedHeroId) {
    const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
    heroEffect = computeHeroMissionEffect(h, mission);
    forcePower = heroEffect.power;
  } else if (mission.kind === "army" && active.assignedArmyId) {
    const a = ps.armies.find((x) => x.id === active.assignedArmyId);
    armyEffect = computeArmyMissionEffect(a, mission);
    forcePower = armyEffect.power;
  }

  const safeRecommended = Math.max(10, recommended);
  const ratio = forcePower > 0 ? forcePower / safeRecommended : 0.5;

  let successChance = 0.4 + (ratio - 1) * 0.25;
  if (ratio >= 1.5) successChance += 0.15;
  if (ratio <= 0.5) successChance -= 0.15;
  if (heroEffect) successChance += heroEffect.successBonus;
  if (armyEffect) successChance += armyEffect.successBonus;
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
  if (armyEffect) {
    casualtyRate = Math.max(0.03, Math.min(0.95, casualtyRate + armyEffect.readinessDelta));
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
      a.readiness = Math.max(20, Math.round(a.readiness - rate * 35));
      a.upkeep = {
        wealth: Math.max(2, Math.round(a.power * 0.08 + a.size * 0.01)),
        materials: Math.max(1, Math.round(a.power * 0.05 + a.size * 0.006)),
      };
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
      a.readiness = Math.max(20, a.readiness - 6);
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
