//web-frontend/lib/apiTypes.ts

export interface Resources {
  food: number;
  materials: number;
  wealth: number;
  mana: number;
  knowledge: number;
  unity: number;
}

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
  settlementLane: "city" | "black_market";
  tier: number;
  maxBuildingSlots: number;
  stats: CityStats;
  buildings: CityBuilding[];
  specializationId: string | null;
  specializationStars: number;
  specializationStarsHistory: Record<string, number>;
  buildingSlotsUsed: number;
  buildingSlotsMax: number;
  production: CityProduction;
}

export interface CityStressState {
  stage: "stable" | "strained" | "crisis" | "lockdown";
  total: number;
  foodPressure: number;
  threatPressure: number;
  unityPressure: number;
  recoveryBurden: number;
  lastUpdatedAt: string;
}

export type MissionResponsePosture = "cautious" | "balanced" | "aggressive" | "desperate";

export type ThreatFamily =
  | "bandits"
  | "mercs"
  | "desperate_towns"
  | "organized_hostile_forces"
  | "early_planar_strike";

export interface RewardBundle {
  wealth?: number;
  food?: number;
  materials?: number;
  mana?: number;
  knowledge?: number;
  influence?: number;
}

export interface MissionSetback {
  kind:
    | "resource_loss"
    | "infrastructure_damage"
    | "unrest"
    | "hero_injury"
    | "army_attrition"
    | "threat_surge";
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
