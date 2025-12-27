//backend/src/domain/missions.ts

import type { City } from "./city";
import type { Hero } from "./heroes";
import type { Army } from "./armies";
import type { World, RegionId } from "./world";

export type MissionKind = "hero" | "army";
export type MissionDifficulty = "low" | "medium" | "high" | "extreme";

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
}

export interface MissionContext {
  city: City;
  heroes: Hero[];
  armies: Army[];
  regionId?: RegionId;
}

// ---- helpers ----

function totalIdleHeroPower(heroes: Hero[]): number {
  return heroes
    .filter((h) => h.status === "idle")
    .reduce((sum: number, h: Hero) => sum + h.power, 0);
}

function totalIdleArmyPower(armies: Army[]): number {
  return armies
    .filter((a) => a.status === "idle")
    .reduce((sum: number, a: Army) => sum + a.power, 0);
}

function summarizeRisk(
  kind: MissionKind,
  recommendedPower: number,
  availablePower: number
): RiskSummary {
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

function makeRewards(
  difficulty: MissionDifficulty,
  kind: MissionKind
): RewardBundle {
  // very rough placeholders; we’ll tune later
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
    // army missions skew more to raw resources
    bundle.materials = Math.round(baseWealth * 0.8);
    bundle.food = Math.round(baseWealth * 0.5);
  }

  return bundle;
}

// ---- main generator ----

export function generateMissionOffers(ctx: MissionContext): MissionOffer[] {
    const { city, heroes, armies, regionId: overrideRegionId } = ctx;
  
    const heroPower = totalIdleHeroPower(heroes);
    const armyPower = totalIdleArmyPower(armies);
  
    // 🔹 Prefer explicit region from context, otherwise default to city’s region
    const regionId = overrideRegionId ?? city.regionId;
  
    // simple IDs for now
    const idBase = Date.now();
  
    const offers: MissionOffer[] = [];
  
    // 1) Low-risk local hero mission
    {
      const kind: MissionKind = "hero";
      const difficulty: MissionDifficulty = "low";
      const recommendedPower = Math.max(30, Math.round(heroPower * 0.4));
  
      offers.push({
        id: `m_${idBase}_hero_low`,
        kind,
        difficulty,
        title: "Scout Local Disturbance",
        description:
          "Strange activity reported near your borders. Send a champion to investigate.",
        regionId,
        recommendedPower,
        expectedRewards: makeRewards(difficulty, kind),
        risk: summarizeRisk(kind, recommendedPower, heroPower),
      });
    }
  
    // 2) Medium army skirmish
    {
      const kind: MissionKind = "army";
      const difficulty: MissionDifficulty = "medium";
      const recommendedPower = Math.max(60, Math.round(armyPower * 0.6));
  
      offers.push({
        id: `m_${idBase}_army_med`,
        kind,
        difficulty,
        title: "Raid Hostile Outpost",
        description:
          "Strike a minor enemy camp to seize supplies and weaken their presence.",
        regionId,
        recommendedPower,
        expectedRewards: makeRewards(difficulty, kind),
        risk: summarizeRisk(kind, recommendedPower, armyPower),
      });
    }
  
    // 3) High diff hero mission (arcane / story hook)
    {
      const kind: MissionKind = "hero";
      const difficulty: MissionDifficulty = "high";
      const recommendedPower = Math.max(80, Math.round(heroPower * 0.9));
  
      offers.push({
        id: `m_${idBase}_hero_high`,
        kind,
        difficulty,
        title: "Delve Ancient Ruins",
        description:
          "A newly uncovered ruin hums with planar energy. Send your best to recover what lies within.",
        regionId,
        recommendedPower,
        expectedRewards: makeRewards(difficulty, kind),
        risk: summarizeRisk(kind, recommendedPower, heroPower),
      });
    }
  
    // 4) Extreme army operation (optional, only if you’re not totally weak)
    if (armyPower > 50) {
      const kind: MissionKind = "army";
      const difficulty: MissionDifficulty = "extreme";
      const recommendedPower = Math.max(120, Math.round(armyPower * 1.1));
  
      offers.push({
        id: `m_${idBase}_army_extreme`,
        kind,
        difficulty,
        title: "Launch Major Offensive",
        description:
          "Commit your main forces to a decisive strike that could reshape control of the region.",
        regionId,
        recommendedPower,
        expectedRewards: makeRewards(difficulty, kind),
        risk: summarizeRisk(kind, recommendedPower, armyPower),
      });
    }
  
    return offers;
}
