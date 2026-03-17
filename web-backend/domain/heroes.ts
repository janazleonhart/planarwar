//web-backend/domain/heroes.ts

export type HeroRole = "champion" | "scout" | "tactician" | "mage";
export type HeroStatus = "idle" | "on_mission";
export type HeroResponseRole = "frontline" | "recon" | "command" | "recovery" | "warding";
export type HeroTraitId =
  | "steadfast"
  | "battle_scarred"
  | "swift"
  | "cautious"
  | "inspiring"
  | "rigid"
  | "planar_savvy"
  | "fragile";

export interface HeroTrait {
  id: HeroTraitId;
  name: string;
  polarity: "pro" | "con";
  summary: string;
  responseBias?: Partial<Record<HeroResponseRole, number>>;
  powerDelta?: number;
  injuryDelta?: number;
}

export interface Hero {
  id: string;
  ownerId: string;
  name: string;
  role: HeroRole;
  responseRoles: HeroResponseRole[];
  traits: HeroTrait[];
  power: number;
  tags: string[];
  status: HeroStatus;
  currentMissionId?: string;
  level?: number;
  xp?: number;
  xpToNext?: number;
  attachments?: { id: string; name: string; kind: string }[];
}

function makeStarterHero(
  ownerId: string,
  id: string,
  name: string,
  role: HeroRole,
  responseRoles: HeroResponseRole[],
  power: number,
  tags: string[],
  traits: HeroTrait[],
): Hero {
  return {
    id,
    ownerId,
    name,
    role,
    responseRoles,
    power,
    tags,
    traits,
    status: "idle",
    level: 1,
    xp: 0,
    xpToNext: 100,
  };
}

export function seedStarterHeroes(ownerId: string): Hero[] {
  return [
    makeStarterHero(
      ownerId,
      "hero_001",
      "Ser Kael the Stormguard",
      "champion",
      ["frontline", "recovery"],
      80,
      ["frontline", "defender"],
      [
        { id: "steadfast", name: "Steadfast", polarity: "pro", summary: "+Frontline staying power during hard fights.", responseBias: { frontline: 18 }, injuryDelta: -0.08 },
        { id: "rigid", name: "Rigid", polarity: "con", summary: "Less adaptable outside direct battle lines.", responseBias: { command: -10, recon: -8 } },
      ],
    ),
    makeStarterHero(
      ownerId,
      "hero_002",
      "Lyra of the Veiled Paths",
      "scout",
      ["recon", "recovery"],
      55,
      ["scout", "ambush"],
      [
        { id: "swift", name: "Swift", polarity: "pro", summary: "+Better for reconnaissance, pursuit, and warning response.", responseBias: { recon: 18, recovery: 6 } },
        { id: "fragile", name: "Fragile", polarity: "con", summary: "Struggles in prolonged attrition fights.", injuryDelta: 0.08, responseBias: { frontline: -12 } },
      ],
    ),
    makeStarterHero(
      ownerId,
      "hero_003",
      "Strategos Varun",
      "tactician",
      ["command", "recovery"],
      65,
      ["tactics", "support"],
      [
        { id: "inspiring", name: "Inspiring", polarity: "pro", summary: "+Improves organized responses and recovery coordination.", responseBias: { command: 18, recovery: 10 } },
        { id: "cautious", name: "Cautious", polarity: "con", summary: "Prefers measured plans over reckless pushes.", responseBias: { frontline: -6 } },
      ],
    ),
    makeStarterHero(
      ownerId,
      "hero_004",
      "Arcanist Meriel",
      "mage",
      ["warding", "command"],
      70,
      ["arcane", "siege"],
      [
        { id: "planar_savvy", name: "Planar Savvy", polarity: "pro", summary: "+Better against strange incursions, wards, and arcane disturbances.", responseBias: { warding: 20, command: 4 } },
        { id: "battle_scarred", name: "Battle-Scarred", polarity: "con", summary: "Old wounds flare during extended crises.", injuryDelta: 0.04 },
      ],
    ),
  ];
}
