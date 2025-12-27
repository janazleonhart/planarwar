//backend/src/domain/heroes.ts

export type HeroRole = "champion" | "scout" | "tactician" | "mage";

export type HeroStatus = "idle" | "on_mission";

export interface Hero {
    id: string;
    ownerId: string;
    name: string;
    role: "champion" | "scout" | "tactician" | "mage";
    power: number;
    tags: string[];
    status: "idle" | "on_mission";
    currentMissionId?: string;
  
    // 🔹 progression (optional so old data doesn’t explode)
    level?: number;
    xp?: number;
    xpToNext?: number;
  
    // if you’re using attachments in the UI:
    attachments?: { id: string; name: string; kind: string }[];
}

export function seedStarterHeroes(ownerId: string): Hero[] {
    return [
      {
        id: "hero_001",
        ownerId,
        name: "Ser Kael the Stormguard",
        role: "champion",
        power: 80,
        tags: ["frontline", "defender"],
        status: "idle",
        level: 1,
        xp: 0,
        xpToNext: 100,
      },
      {
        id: "hero_002",
        ownerId,
        name: "Lyra of the Veiled Paths",
        role: "scout",
        power: 55,
        tags: ["scout", "ambush"],
        status: "idle",
        level: 1,
        xp: 0,
        xpToNext: 100,
      },
      {
        id: "hero_003",
        ownerId,
        name: "Strategos Varun",
        role: "tactician",
        power: 65,
        tags: ["tactics", "support"],
        status: "idle",
        level: 1,
        xp: 0,
        xpToNext: 100,
      },
      {
        id: "hero_004",
        ownerId,
        name: "Arcanist Meriel",
        role: "mage",
        power: 70,
        tags: ["arcane", "siege"],
        status: "idle",
        level: 1,
        xp: 0,
        xpToNext: 100,
      },
    ];
  }
