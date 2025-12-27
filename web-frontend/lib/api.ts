//frontend/src/lib/api.ts

export interface CityBuilding {
    id: string;
    kind: "housing" | "farmland" | "mine" | "arcane_spire";
    level: number;
    name: string;
  }
  
  export interface CityStats {
    population: number;
    stability: number;
    prosperity: number;
    security: number;
    infrastructure: number;
    arcaneSaturation: number;
    influence: number;
    unity: number;
  }
  
  export interface CityProduction {
    foodPerTick: number;
    materialsPerTick: number;
    wealthPerTick: number;
    manaPerTick: number;
    knowledgePerTick: number;
    unityPerTick: number;
  }
  
  export interface CitySummary {
    id: string;
    name: string;
    shardId: string;
    regionId: string;
    tier: number;
    maxBuildingSlots: number;
    stats: CityStats;
    buildings: CityBuilding[];
    // 🔹 NEW: specialization info
    specializationId: string | null;
    specializationStars: number;
    specializationStarsHistory: Record<string, number>;
    buildingSlotsUsed: number;
    buildingSlotsMax: number;
    production: CityProduction;
  }
  
  export interface MissionRisk {
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
    kind: "hero" | "army";
    difficulty: "low" | "medium" | "high" | "extreme";
    title: string;
    description: string;
    regionId: string;
    recommendedPower: number;
    expectedRewards: RewardBundle;
    risk: MissionRisk;
  }
  
  export interface ActiveMission {
    instanceId: string;
    mission: MissionOffer;
    startedAt: string;  // ISO string
    finishesAt: string; // ISO string
    assignedHeroId?: string;
    assignedArmyId?: string;
  }
  
  export interface Resources {
    food: number;
    materials: number;
    wealth: number;
    mana: number;
    knowledge: number;
    unity: number;
  }
  
  export interface PoliciesState {
    highTaxes: boolean;
    openTrade: boolean;
    conscription: boolean;
    arcaneFreedom: boolean;
  }
  
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

  export interface HeroAttachment {
    id: string;
    kind: "valor_charm" | "scouting_cloak" | "arcane_focus";
    name: string;
  }

  export interface WorkshopJob {
    id: string;
    attachmentKind: "valor_charm" | "scouting_cloak" | "arcane_focus";
    startedAt: string;
    finishesAt: string;
    completed: boolean;
  }
  
  export type ArmyType = "militia" | "line" | "vanguard";
  export type ArmyStatus = "idle" | "on_mission";
  
  export interface Army {
    id: string;
    cityId: string;
    name: string;
    type: ArmyType;
    power: number;
    size: number;
    status: ArmyStatus;
    currentMissionId?: string;
  }
  
  export type TechCategory = "infrastructure" | "agriculture" | "military";
  
  export interface TechSummary {
    id: string;
    name: string;
    description: string;
    category: TechCategory;
    cost: number;
  }
  
  export interface ActiveResearchView {
    techId: string;
    name: string;
    description: string;
    category: string;
    cost: number;
    progress: number;
  }
  
  export interface RegionWarState {
    regionId: string;
    control: number; // 0–100
    threat: number;  // 0–100
  }

  export type GameEventKind =
  | "mission_start"
  | "mission_complete"
  | "tech_start"
  | "tech_complete"
  | "army_raised"
  | "army_reinforced"
  | "building_constructed"
  | "building_upgraded"
  | "hero_geared"
  | "hero_recruited"
  | "workshop_start"
  | "workshop_complete"
  | "city_stress_change"
  | "mission_refresh_region"
  | "city_tier_up"
  | "city_morph"
  | "resource_tier_up";

  export interface GameEvent {
    id: string;
    timestamp: string;
    kind: GameEventKind;
    message: string;
    techId?: string;
    missionId?: string;
    armyId?: string;
    heroId?: string;
    regionId?: string;
    outcome?: "success" | "partial" | "failure";
  }

  export interface ResourceTierState {
    resourceKey: string;  // was ResourceKey
    tier: number;
    stars: number;
    totalInvested: number;
  }
  

  export type CityStressStage = "stable" | "strained" | "crisis" | "lockdown";

    export interface CityStressState {
    stage: CityStressStage;
    total: number;
    foodPressure: number;
    threatPressure: number;
    unityPressure: number;
    lastUpdatedAt: string;
    }
  
  export interface MeProfile {
    id: string;
    displayName: string;
    faction: string;
    rank: string;
    lastLoginAt: string;
    lastTickAt: string;
    tickMs: number;
    playerId: string;
    city: CitySummary;
    missions: MissionOffer[];
    activeMissions: ActiveMission[];
    resources: Resources;
    resourceTiers?: Record<string, ResourceTierState>;
    policies: PoliciesState;
    heroes: Hero[];
    armies: Army[];
    researchedTechIds: string[];
    availableTechs: TechSummary[];
    activeResearch: ActiveResearchView | null;
    regionWar: RegionWarState[];
    events: GameEvent[];
    workshopJobs: WorkshopJob[];
    cityStress: CityStressState;
    // 🔹 NEW: specialization info
    specializationId: string | null;
    specializationStars: number;
    specializationStarsHistory: Record<string, number>;
  }
  
  export const API_BASE_URL =
    (import.meta as any).env.VITE_API_BASE_URL ?? "http://localhost:4000";
  
  export async function fetchMe(): Promise<MeProfile> {
    const res = await fetch(`${API_BASE_URL}/api/me`);
    if (!res.ok) {
      throw new Error(`Failed to fetch /api/me: ${res.status}`);
    }
    return res.json();
  }
  
  export async function startTech(techId: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/tech/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ techId }),
    });
  
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as any));
      const msg = (body as any).error || `Tech start failed: ${res.status}`;
      throw new Error(msg);
    }
  }

  export async function api<T = any>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      // include cookies if you later gate this behind auth
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      ...init,
    });
  
    if (!res.ok) {
      throw new Error(`Failed to fetch ${path}: ${res.status}`);
    }
  
    return res.json() as Promise<T>;
  }
  