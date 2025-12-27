// worldcore/characters/TitleTypes.ts

import { Attributes } from "./CharacterTypes";

export interface TitleDefinition {
  id: string;
  name: string;
  description: string;
  unlock: {
    type: "kill" | "harvest";
    target: string;      // e.g. "town_rat", "ore_vein_small"
    required: number;    // threshold
  };
  bonuses?: {
    attributes?: Partial<Attributes>;
  };
}

export const TITLES: Record<string, TitleDefinition> = {
  rat_slayer: {
    id: "rat_slayer",
    name: "Rat Slayer",
    description: "Awarded for slaying 50 Town Rats.",
    unlock: { type: "kill", target: "town_rat", required: 5 },
    bonuses: {
      attributes: { str: 1 },
    },
  },

  ore_breaker: {
    id: "ore_breaker",
    name: "Ore Breaker",
    description: "Awarded for harvesting 100 Hematite Ore Veins.",
    unlock: { type: "harvest", target: "ore_vein_small", required: 5 },
    bonuses: {
      attributes: { sta: 1 },
    },
  },
};

export function getTitleDefinition(id: string): TitleDefinition | undefined {
  return TITLES[id];
}

export function listAllTitles(): TitleDefinition[] {
  return Object.values(TITLES);
}
