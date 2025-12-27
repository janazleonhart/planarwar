//backend/src/config.ts

// Different “profiles” for running the demo backend.
// You can swap these with DEMO_PROFILE or just edit the values here.
export type DemoProfile = "dev" | "fast" | "ultra";

const PROFILE: DemoProfile =
  (process.env.DEMO_PROFILE as DemoProfile) ?? "dev";

// ---- Tick settings ----

interface TickSettings {
  tickMs: number;          // how long one production tick is in real ms
  maxTicksPerRequest: number;
}

const tickByProfile: Record<DemoProfile, TickSettings> = {
  // Normal-ish play
  dev: {
    tickMs: 60_000,        // 1 minute
    maxTicksPerRequest: 60 // caps at 1 hour per call
  },

  // Fast testbed – great for simulating long sessions quickly
  fast: {
    tickMs: 5_000,         // 5 seconds
    maxTicksPerRequest: 600
  },

  // Ultra fast chaos mode
  ultra: {
    tickMs: 1_000,         // 1 second
    maxTicksPerRequest: 3600
  }
};

// ---- Starting resources ----

interface StartingResources {
  food: number;
  materials: number;
  wealth: number;
  mana: number;
  knowledge: number;
  unity: number;
}

const resourcesByProfile: Record<DemoProfile, StartingResources> = {
  dev: {
    food: 120,
    materials: 80,
    wealth: 300,
    mana: 20,
    knowledge: 5,
    unity: 10
  },
  fast: {
    food: 500,
    materials: 400,
    wealth: 1000,
    mana: 100,
    knowledge: 50,
    unity: 25
  },
  ultra: {
    food: 5000,
    materials: 5000,
    wealth: 20000,
    mana: 500,
    knowledge: 200,
    unity: 100
  }
};

// ---- Mission duration (in minutes) ----

interface MissionDurations {
  low: number;
  medium: number;
  high: number;
  extreme: number;
}

const missionDurationsByProfile: Record<DemoProfile, MissionDurations> = {
  dev: {
    low: 5,
    medium: 10,
    high: 20,
    extreme: 30
  },
  fast: {
    low: 1,
    medium: 2,
    high: 5,
    extreme: 10
  },
  ultra: {
    low: 0.25,   // 15 seconds
    medium: 0.5, // 30 seconds
    high: 1,     // 1 minute
    extreme: 2   // 2 minutes
  }
};

export const demoProfile: DemoProfile = PROFILE;
export const tickConfig = tickByProfile[PROFILE];
export const startingResourcesConfig = resourcesByProfile[PROFILE];
export const missionDurationConfig = missionDurationsByProfile[PROFILE];
