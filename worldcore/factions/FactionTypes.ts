// worldcore/factions/FactionTypes.ts

export type FactionId = string;

export interface Faction {
  id: FactionId;

  // Display name, e.g. "Emberfall Legion"
  name: string;

  // Optional shorter / styled nickname, e.g. "Emberfall Empire"
  nickname?: string;

  // Flavor text for UI / codex.
  description?: string;

  // For future map / UI coloring ("gold", "#ff8800", "faction_emberfall", etc.)
  color?: string;

  // NPC vs player-made
  isNpc: boolean;
}

/**
 * Temporary in-memory faction registry.
 * Later we can back this with Postgres.
 */
const FACTIONS: Record<FactionId, Faction> = {
  test_empire: {
    id: "test_empire",
    name: "Test Empire",
    nickname: "Test Empire",
    description:
      "A placeholder NPC empire used for early region control and naming tests.",
    color: "gold",
    isNpc: true,
  },
};

export function getFactionById(id: FactionId): Faction | undefined {
  return FACTIONS[id];
}

/**
 * Convenience helper for tests / tools.
 */
export function getAllFactions(): Faction[] {
  return Object.values(FACTIONS);
}
