//web-backend/domain/missions.ts

import type { City } from "./city";
import type { Hero } from "./heroes";
import type { Army } from "./armies";
import type { RegionId } from "./world";

import type { CityMudConsumerSummary, CityMudBridgeSummary } from "./cityMudBridge";

export type MissionKind = "hero" | "army";
export type MissionDifficulty = "low" | "medium" | "high" | "extreme";
export type MissionResponseTag = "frontline" | "recon" | "command" | "recovery" | "warding" | "defense";

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

export interface MissionOffer {
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

export function generateMissionOffers(ctx: MissionContext): MissionOffer[] {
  const { city, heroes, armies, regionId: overrideRegionId } = ctx;

  const heroPower = totalIdleHeroPower(heroes);
  const armyPower = totalIdleArmyPower(armies);
  const regionId = overrideRegionId ?? city.regionId;
  const idBase = Date.now();

  const offers: MissionOffer[] = [];

  offers.push({
    id: `m_${idBase}_hero_low`,
    kind: "hero",
    difficulty: "low",
    title: "Scout Local Disturbance",
    description: "Strange activity reported near your borders. Send a champion to investigate.",
    regionId,
    recommendedPower: Math.max(30, Math.round(heroPower * 0.4)),
    expectedRewards: makeRewards("low", "hero"),
    risk: summarizeRisk("hero", Math.max(30, Math.round(heroPower * 0.4)), heroPower),
    responseTags: ["recon", "recovery"],
  });

  offers.push({
    id: `m_${idBase}_army_med`,
    kind: "army",
    difficulty: "medium",
    title: "Raid Hostile Outpost",
    description: "Strike a minor enemy camp to seize supplies and weaken their presence.",
    regionId,
    recommendedPower: Math.max(60, Math.round(armyPower * 0.6)),
    expectedRewards: makeRewards("medium", "army"),
    risk: summarizeRisk("army", Math.max(60, Math.round(armyPower * 0.6)), armyPower),
    responseTags: ["frontline", "command"],
  });

  offers.push({
    id: `m_${idBase}_hero_high`,
    kind: "hero",
    difficulty: "high",
    title: "Delve Ancient Ruins",
    description: "A newly uncovered ruin hums with planar energy. Send your best to recover what lies within.",
    regionId,
    recommendedPower: Math.max(80, Math.round(heroPower * 0.9)),
    expectedRewards: makeRewards("high", "hero"),
    risk: summarizeRisk("hero", Math.max(80, Math.round(heroPower * 0.9)), heroPower),
    responseTags: ["warding", "command"],
  });

  if (armyPower > 50) {
    offers.push({
      id: `m_${idBase}_army_extreme`,
      kind: "army",
      difficulty: "extreme",
      title: "Launch Major Offensive",
      description: "Commit your main forces to a decisive strike that could reshape control of the region.",
      regionId,
      recommendedPower: Math.max(120, Math.round(armyPower * 1.1)),
      expectedRewards: makeRewards("extreme", "army"),
      risk: summarizeRisk("army", Math.max(120, Math.round(armyPower * 1.1)), armyPower),
      responseTags: ["frontline", "command", "recovery"],
    });
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
