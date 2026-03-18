//web-backend/domain/missions.ts

import type { City } from "./city";
import type { Hero } from "./heroes";
import type { Army } from "./armies";
import type { RegionId } from "./world";

import type { CityMudConsumerSummary, CityMudBridgeSummary } from "./cityMudBridge";

export type MissionKind = "hero" | "army";
export type MissionDifficulty = "low" | "medium" | "high" | "extreme";
export type MissionResponseTag = "frontline" | "recon" | "command" | "recovery" | "warding" | "defense";
export type MissionResponsePosture = "cautious" | "balanced" | "aggressive" | "desperate";
export type ThreatFamily = "bandits" | "mercs" | "desperate_towns" | "organized_hostile_forces" | "early_planar_strike";
export type RecoveryContractKind = "stabilize_district" | "repair_works" | "relief_convoys" | "counter_rumors";

export type MissionSetbackKind = "resource_loss" | "infrastructure_damage" | "unrest" | "hero_injury" | "army_attrition" | "threat_surge";

export interface MissionSetback {
  kind: MissionSetbackKind;
  severity: number;
  summary: string;
  detail: string;
  resources?: RewardBundle;
  statImpacts?: Record<string, number>;
}

export interface MissionDefenseReceipt {
  id: string;
  missionId: string;
  missionTitle: string;
  createdAt: string;
  outcome: "success" | "partial" | "failure";
  posture: MissionResponsePosture;
  threatFamily?: ThreatFamily;
  summary: string;
  setbacks: MissionSetback[];
}

export interface RiskSummary {
  casualtyRisk: string;
  heroInjuryRisk?: string;
  notes?: string;
}

export interface RewardBundle {
  wealth?: number;
  food?: number;
  materials?: number;
  mana?: number;
  knowledge?: number;
  influence?: number;
}

export interface MissionOfferSupportGuidance {
  state: "stable" | "pressured" | "restricted";
  severity: number;
  headline: string;
  detail: string;
  recommendedAction: string;
}

export type WarningIntelQuality = "faint" | "usable" | "clear" | "precise";
export type PressureMapConfidence = "watch" | "credible" | "urgent";

export interface MotherBrainPressureWindow {
  id: string;
  generatedAt: string;
  earliestWindowAt: string;
  latestWindowAt: string;
  pressureScore: number;
  exposureScore: number;
  confidence: PressureMapConfidence;
  threatFamily: ThreatFamily;
  responseTags: MissionResponseTag[];
  reasons: string[];
  summary: string;
  detail: string;
  sourceMissionIds: string[];
}

export interface ThreatWarning {
  threatFamily?: ThreatFamily;
  targetingPressure?: number;
  targetingReasons?: string[];
  id: string;
  missionId?: string;
  targetRegionId: string;
  issuedAt: string;
  earliestImpactAt: string;
  latestImpactAt: string;
  severity: number;
  intelQuality: WarningIntelQuality;
  headline: string;
  detail: string;
  responseTags: MissionResponseTag[];
  recommendedAction: string;
  recommendedHeroId?: string;
  recommendedArmyId?: string;
}

export interface MissionOffer {
  contractKind?: RecoveryContractKind;
  contractPressureDelta?: number;
  contractTrustDelta?: number;
  contractRecoveryBurdenDelta?: number;
  threatFamily?: ThreatFamily;
  targetingPressure?: number;
  targetingReasons?: string[];
  id: string;
  kind: MissionKind;
  difficulty: MissionDifficulty;
  title: string;
  description: string;
  regionId: string;
  recommendedPower: number;
  expectedRewards: RewardBundle;
  risk: RiskSummary;
  responseTags: MissionResponseTag[];
  supportGuidance?: MissionOfferSupportGuidance;
}

export interface MissionContext {
  city: City;
  heroes: Hero[];
  armies: Army[];
  regionId?: RegionId;
  regionThreat?: number;
  cityThreatPressure?: number;
  cityStressTotal?: number;
}

function totalIdleHeroPower(heroes: Hero[]): number {
  return heroes.filter((h) => h.status === "idle").reduce((sum, h) => sum + h.power, 0);
}

function totalIdleArmyPower(armies: Army[]): number {
  return armies.filter((a) => a.status === "idle").reduce((sum, a) => sum + a.power, 0);
}

function summarizeRisk(kind: MissionKind, recommendedPower: number, availablePower: number): RiskSummary {
  if (recommendedPower <= 0) {
    return {
      casualtyRisk: "minimal",
      notes: "Training exercise; little real danger expected.",
    };
  }

  const ratio = availablePower / recommendedPower;

  if (ratio >= 1.5) {
    return {
      casualtyRisk: "minimal",
      heroInjuryRisk: kind === "hero" ? "low" : undefined,
      notes: "Your forces significantly overmatch the target.",
    };
  }

  if (ratio >= 1.0) {
    return {
      casualtyRisk: "moderate",
      heroInjuryRisk: kind === "hero" ? "moderate" : undefined,
      notes: "Well matched; losses possible if things go wrong.",
    };
  }

  if (ratio >= 0.7) {
    return {
      casualtyRisk: "high",
      heroInjuryRisk: kind === "hero" ? "severe" : undefined,
      notes: "You are outgunned. Success will be costly.",
    };
  }

  return {
    casualtyRisk: "critical",
    heroInjuryRisk: kind === "hero" ? "crippling" : undefined,
    notes: "Suicidal odds. Only attempt if truly desperate.",
  };
}

function makeRewards(difficulty: MissionDifficulty, kind: MissionKind): RewardBundle {
  const baseWealth =
    difficulty === "low"
      ? 25
      : difficulty === "medium"
      ? 60
      : difficulty === "high"
      ? 120
      : 220;

  const bundle: RewardBundle = {
    wealth: baseWealth,
    materials: Math.round(baseWealth * 0.5),
    food: Math.round(baseWealth * 0.3),
  };

  if (kind === "hero") {
    bundle.knowledge = Math.round(baseWealth * 0.25);
    bundle.influence = Math.round(baseWealth * 0.2);
  } else {
    bundle.materials = Math.round(baseWealth * 0.8);
    bundle.food = Math.round(baseWealth * 0.5);
  }

  return bundle;
}


function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function uniqueReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons.filter(Boolean))).slice(0, 4);
}

function threatFamilyLabel(family: ThreatFamily): string {
  switch (family) {
    case "bandits":
      return "Bandits";
    case "mercs":
      return "Mercenaries";
    case "desperate_towns":
      return "Desperate towns";
    case "organized_hostile_forces":
      return "Organized hostile forces";
    case "early_planar_strike":
      return "Early planar strike";
    default:
      return family;
  }
}

interface ThreatFamilyPressure {
  family: ThreatFamily;
  pressure: number;
  reasons: string[];
}

function computeThreatFamilyPressure(ctx: MissionContext): ThreatFamilyPressure[] {
  const prosperity = Number(ctx.city.stats.prosperity ?? 0);
  const security = Number(ctx.city.stats.security ?? 0);
  const infrastructure = Number(ctx.city.stats.infrastructure ?? 0);
  const influence = Number(ctx.city.stats.influence ?? 0);
  const stability = Number(ctx.city.stats.stability ?? 0);
  const unity = Number(ctx.city.stats.unity ?? 0);
  const arcane = Number(ctx.city.stats.arcaneSaturation ?? 0);
  const regionThreat = clampPercent(Number(ctx.regionThreat ?? 0));
  const stress = clampPercent(Number(ctx.cityStressTotal ?? ctx.cityThreatPressure ?? 0));
  const pressure = clampPercent(Number(ctx.cityThreatPressure ?? stress));
  const exposure = clampPercent(prosperity * 0.38 + infrastructure * 0.22 + influence * 0.18 + arcane * 0.12 - security * 0.42 + regionThreat * 0.2);

  const families: ThreatFamilyPressure[] = [
    {
      family: "bandits",
      pressure: clampPercent(prosperity * 0.44 + exposure * 0.32 + regionThreat * 0.2 + (100 - security) * 0.16),
      reasons: uniqueReasons([
        prosperity >= 55 ? `Prosperity ${prosperity}/100 gives raiders something worth taking.` : "",
        security <= 45 ? `Security only at ${security}/100 leaves soft approach lanes.` : "",
        regionThreat >= 50 ? `Regional threat is already elevated at ${regionThreat}/100.` : "",
      ]),
    },
    {
      family: "mercs",
      pressure: clampPercent(prosperity * 0.28 + influence * 0.28 + pressure * 0.24 + exposure * 0.18 + regionThreat * 0.1),
      reasons: uniqueReasons([
        influence >= 50 ? `Influence ${influence}/100 makes the city visible to paid hostile actors.` : "",
        prosperity >= 50 ? `Prosperity ${prosperity}/100 can finance contract violence.` : "",
        pressure >= 45 ? `Pressure ${pressure}/100 suggests someone could be hired to exploit the strain.` : "",
      ]),
    },
    {
      family: "desperate_towns",
      pressure: clampPercent((100 - stability) * 0.24 + (100 - unity) * 0.22 + prosperity * 0.18 + pressure * 0.24 + regionThreat * 0.12),
      reasons: uniqueReasons([
        stability <= 50 ? `Stability at ${stability}/100 makes nearby desperation easier to spill over.` : "",
        unity <= 52 ? `Unity at ${unity}/100 signals social fracture and weak relief posture.` : "",
        prosperity >= 55 ? `Prosperity ${prosperity}/100 attracts hungry neighbors and refugees.` : "",
      ]),
    },
    {
      family: "organized_hostile_forces",
      pressure: clampPercent(regionThreat * 0.42 + pressure * 0.24 + exposure * 0.16 + influence * 0.18),
      reasons: uniqueReasons([
        regionThreat >= 55 ? `Regional threat ${regionThreat}/100 supports coordinated enemy staging.` : "",
        pressure >= 50 ? `City pressure ${pressure}/100 invites disciplined probing attacks.` : "",
        influence >= 45 ? `Influence ${influence}/100 makes the city a strategic target.` : "",
      ]),
    },
    {
      family: "early_planar_strike",
      pressure: clampPercent(arcane * 0.58 + regionThreat * 0.16 + exposure * 0.1 + pressure * 0.16),
      reasons: uniqueReasons([
        arcane >= 55 ? `Arcane saturation ${arcane}/100 is bright enough to draw planar attention.` : "",
        regionThreat >= 45 ? `Regional chaos ${regionThreat}/100 makes planar interference easier to mask.` : "",
        pressure >= 48 ? `Pressure ${pressure}/100 weakens orderly containment.` : "",
      ]),
    },
  ];

  return families
    .map((entry) => ({ ...entry, reasons: entry.reasons.length > 0 ? entry.reasons : ["The city is exposed enough to register on hostile attention maps."] }))
    .sort((a, b) => b.pressure - a.pressure);
}

function pickFamilyForLane(families: ThreatFamilyPressure[], lane: "hero_low" | "army_med" | "hero_high" | "army_extreme"): ThreatFamilyPressure {
  const top = families[0] ?? { family: "bandits" as ThreatFamily, pressure: 30, reasons: ["The frontier never stays quiet for long."] };
  if (lane === "hero_high") {
    return families.find((entry) => entry.family === "early_planar_strike" && entry.pressure >= 45) ?? families[1] ?? top;
  }
  if (lane === "army_extreme") return top;
  if (lane === "army_med") {
    return families.find((entry) => entry.family === "organized_hostile_forces" || entry.family === "mercs" || entry.family === "bandits") ?? top;
  }
  return families.find((entry) => entry.family === "bandits" || entry.family === "desperate_towns" || entry.family === "mercs") ?? top;
}

function laneTemplate(family: ThreatFamily, lane: "hero_low" | "army_med" | "hero_high" | "army_extreme"): { title: string; description: string; kind: MissionKind; difficulty: MissionDifficulty; responseTags: MissionResponseTag[] } {
  const map: Record<ThreatFamily, Record<string, { title: string; description: string; kind: MissionKind; difficulty: MissionDifficulty; responseTags: MissionResponseTag[] }>> = {
    bandits: {
      hero_low: { title: "Trace Bandit Scouts", description: "Raiders are testing routes, granaries, and escort habits around your borders.", kind: "hero", difficulty: "low", responseTags: ["recon", "recovery"] },
      army_med: { title: "Break Bandit Camp", description: "A fortified raider camp is feeding repeat strikes into your hinterland.", kind: "army", difficulty: "medium", responseTags: ["frontline", "command"] },
      hero_high: { title: "Hunt the Bandit Captain", description: "A sharper hand is coordinating bandit pressure and fencing stolen goods.", kind: "hero", difficulty: "high", responseTags: ["recon", "command"] },
      army_extreme: { title: "Sweep the Raider Ring", description: "Multiple camps have linked up into a roaming threat that can maul supply lines outright.", kind: "army", difficulty: "extreme", responseTags: ["frontline", "command", "recovery"] },
    },
    mercs: {
      hero_low: { title: "Shadow the Contract Brokers", description: "Paid blades are sounding out your routes, watch rotations, and likely weak points.", kind: "hero", difficulty: "low", responseTags: ["recon", "command"] },
      army_med: { title: "Disrupt Mercenary Raid Column", description: "A hired force is massing for a disciplined strike instead of a messy raid.", kind: "army", difficulty: "medium", responseTags: ["frontline", "command"] },
      hero_high: { title: "Sabotage the Paymaster", description: "Break the payroll, orders, or pacts holding the mercenary host together.", kind: "hero", difficulty: "high", responseTags: ["recon", "warding"] },
      army_extreme: { title: "Crush the Mercenary Host", description: "A full hired host is lining up to exploit your visible prosperity and pressure.", kind: "army", difficulty: "extreme", responseTags: ["frontline", "command", "defense"] },
    },
    desperate_towns: {
      hero_low: { title: "Quiet Border Petitioners", description: "Refugees, deserters, and hungry settlers are clustering near your outer wards.", kind: "hero", difficulty: "low", responseTags: ["recovery", "recon"] },
      army_med: { title: "Shield Grain Convoys", description: "A starving border community is turning on convoys and patrols to survive.", kind: "army", difficulty: "medium", responseTags: ["defense", "recovery"] },
      hero_high: { title: "Negotiate or Break the Siege", description: "Someone must cut through fear, rumor, and opportunists before a local panic hardens into bloodshed.", kind: "hero", difficulty: "high", responseTags: ["command", "recovery"] },
      army_extreme: { title: "Relieve the Border Push", description: "Desperation has become organized seizure of food, tools, and shelter across the frontier.", kind: "army", difficulty: "extreme", responseTags: ["defense", "frontline", "recovery"] },
    },
    organized_hostile_forces: {
      hero_low: { title: "Scout Hostile Cells", description: "Enemy scouts and spotters are probing gates, routes, and watch patterns with discipline.", kind: "hero", difficulty: "low", responseTags: ["recon", "command"] },
      army_med: { title: "Break the Hostile Spearhead", description: "A coordinated hostile force is testing how quickly your city can answer pressure.", kind: "army", difficulty: "medium", responseTags: ["frontline", "defense"] },
      hero_high: { title: "Cripple Enemy Command", description: "Hit planners, banners, or ritual officers before the offensive window tightens.", kind: "hero", difficulty: "high", responseTags: ["command", "warding"] },
      army_extreme: { title: "Hold Against Coordinated Offensive", description: "A serious hostile force has enough shape to become a true siege rehearsal.", kind: "army", difficulty: "extreme", responseTags: ["frontline", "command", "defense"] },
    },
    early_planar_strike: {
      hero_low: { title: "Read the Planar Distortion", description: "Anomalies and whispers suggest the veil is thinning near your holdings.", kind: "hero", difficulty: "low", responseTags: ["warding", "recon"] },
      army_med: { title: "Contain Rift Incursion", description: "A small breach is bleeding hostile entities into already stressed approaches.", kind: "army", difficulty: "medium", responseTags: ["warding", "frontline"] },
      hero_high: { title: "Seal the Emerging Rift Node", description: "A sharper planar knot is forming and may become a recurring strike point if left alone.", kind: "hero", difficulty: "high", responseTags: ["warding", "command"] },
      army_extreme: { title: "Repel Early Planar Strike", description: "The city has drawn a genuine extraplanar response window rather than frontier noise.", kind: "army", difficulty: "extreme", responseTags: ["warding", "frontline", "command"] },
    },
  };
  return map[family][lane];
}

export function generateMissionOffers(ctx: MissionContext): MissionOffer[] {
  const { city, heroes, armies, regionId: overrideRegionId } = ctx;

  const heroPower = totalIdleHeroPower(heroes);
  const armyPower = totalIdleArmyPower(armies);
  const regionId = overrideRegionId ?? city.regionId;
  const idBase = Date.now();
  const offers: MissionOffer[] = [];
  const families = computeThreatFamilyPressure(ctx);

  const buildOffer = (lane: "hero_low" | "army_med" | "hero_high" | "army_extreme", fallbackPower: number): MissionOffer => {
    const familyInfo = pickFamilyForLane(families, lane);
    const template = laneTemplate(familyInfo.family, lane);
    const pressureBoost = Math.round((familyInfo.pressure ?? 0) * (lane === "army_extreme" ? 0.55 : lane === "hero_high" ? 0.42 : 0.28));
    const targetReasons = familyInfo.reasons.slice(0, 3);
    return {
      id: `m_${idBase}_${lane}`,
      kind: template.kind,
      difficulty: template.difficulty,
      title: `${template.title} (${threatFamilyLabel(familyInfo.family)})`,
      description: `${template.description} Pressure focus: ${targetReasons.join(" ")}`.trim(),
      regionId,
      recommendedPower: Math.max(fallbackPower, fallbackPower + pressureBoost),
      expectedRewards: makeRewards(template.difficulty, template.kind),
      risk: summarizeRisk(template.kind, Math.max(fallbackPower, fallbackPower + pressureBoost), template.kind === "hero" ? heroPower : armyPower),
      responseTags: [...template.responseTags],
      threatFamily: familyInfo.family,
      targetingPressure: familyInfo.pressure,
      targetingReasons: targetReasons,
    };
  };

  offers.push(buildOffer("hero_low", Math.max(30, Math.round(heroPower * 0.4))));
  offers.push(buildOffer("army_med", Math.max(60, Math.round(armyPower * 0.6))));
  offers.push(buildOffer("hero_high", Math.max(80, Math.round(heroPower * 0.9))));

  const topPressure = families[0]?.pressure ?? 0;
  if (armyPower > 50 || topPressure >= 55) {
    offers.push(buildOffer("army_extreme", Math.max(120, Math.round(armyPower * 1.1))));
  }

  return offers;
}

function missionSupportStateSeverity(difficulty: MissionDifficulty): number {
  switch (difficulty) {
    case "low":
      return 18;
    case "medium":
      return 34;
    case "high":
      return 56;
    case "extreme":
      return 74;
    default:
      return 40;
  }
}

export function applyMissionConsumerGuidance(
  offers: MissionOffer[],
  bridgeSummary: CityMudBridgeSummary,
  consumers: CityMudConsumerSummary,
): MissionOffer[] {
  return offers.map((offer) => {
    const baseSeverity = missionSupportStateSeverity(offer.difficulty);
    const missionConsumer = consumers.missionBoard;
    const civicConsumer = consumers.civicServices;
    const severity = Math.max(baseSeverity, missionConsumer.severity, bridgeSummary.frontierPressure);

    let supportState: MissionOfferSupportGuidance["state"] = "stable";
    if (missionConsumer.state === "restricted") {
      supportState = "restricted";
    } else if (missionConsumer.state === "pressured" || offer.difficulty === "high" || offer.difficulty === "extreme" || bridgeSummary.bridgeBand === "strained") {
      supportState = "pressured";
    }

    const supportGuidance: MissionOfferSupportGuidance = supportState === "restricted"
      ? {
          state: "restricted",
          severity: Math.max(severity, 75),
          headline: "Mission support is in defensive triage.",
          detail: `${missionConsumer.detail} ${civicConsumer.detail}`,
          recommendedAction: "Bias toward escort, defense, recovery, or emergency contracts until city pressure eases.",
        }
      : supportState === "pressured"
      ? {
          state: "pressured",
          severity: Math.max(severity, 52),
          headline: "Mission support is available with visible drag.",
          detail: `${missionConsumer.headline} ${bridgeSummary.note}`,
          recommendedAction: offer.kind === "hero"
            ? "Surface risk/support caveats and favor focused missions over broad frontier commitments."
            : "Surface logistics risk and prefer medium operations over force-heavy offensives.",
        }
      : {
          state: "stable",
          severity: Math.min(40, severity),
          headline: "Mission support lanes are open.",
          detail: "The city can back routine outward missions without leaning hard on emergency logistics or civic triage.",
          recommendedAction: "Keep support notes lightweight and reserve hard warnings for real spikes.",
        };

    const riskNotes = [offer.risk.notes, supportGuidance.headline, supportGuidance.detail].filter(Boolean).join(" ");

    return {
      ...offer,
      risk: {
        ...offer.risk,
        notes: riskNotes,
      },
      supportGuidance,
    };
  });
}
