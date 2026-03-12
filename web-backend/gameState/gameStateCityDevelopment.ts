//web-backend/gameState/gameStateCityDevelopment.ts

import { getTechById } from "../domain/tech";

import type { TechDefinition } from "../domain/tech";
import type {
  ActiveResearch,
  GameEventInput,
  PlayerState,
  Resources,
} from "../gameState";

export type BuildingKind = "housing" | "farmland" | "mine" | "arcane_spire";

export interface BuildBuildingResult {
  status:
    | "ok"
    | "not_found"
    | "unknown_kind"
    | "no_slots"
    | "insufficient_resources";
  message?: string;
  building?: any;
  resources?: Resources;
}

export interface UpgradeBuildingResult {
  status:
    | "ok"
    | "not_found"
    | "insufficient_resources"
    | "unknown_kind";
  message?: string;
  building?: any;
  resources?: Resources;
}

export interface StartResearchResult {
  status:
    | "ok"
    | "not_found"
    | "unknown_tech"
    | "already_researched"
    | "already_researching";
  message?: string;
  research?: ActiveResearch;
}

export interface CityDevelopmentDeps {
  getPlayerState(playerId: string): PlayerState | undefined;
  tickPlayerState?(ps: PlayerState, now: Date): void;
  pushEvent(ps: PlayerState, input: GameEventInput): void;
}

const BUILDING_BASE_COST: Record<
  BuildingKind,
  { materials: number; wealth: number; mana?: number; niceName: string }
> = {
  housing: {
    materials: 60,
    wealth: 30,
    niceName: "Housing Block",
  },
  farmland: {
    materials: 50,
    wealth: 20,
    niceName: "Farmland Plot",
  },
  mine: {
    materials: 80,
    wealth: 40,
    niceName: "Mining Operation",
  },
  arcane_spire: {
    materials: 70,
    wealth: 50,
    mana: 30,
    niceName: "Arcane Spire",
  },
};

function canAffordBuilding(
  resources: Resources,
  base: { materials: number; wealth: number; mana?: number },
  level: number
): { ok: boolean; cost: { materials: number; wealth: number; mana?: number } } {
  const scale = 1 + (level - 1) * 0.4;
  const materials = Math.round(base.materials * scale);
  const wealth = Math.round(base.wealth * scale);
  const mana = base.mana ? Math.round(base.mana * scale) : undefined;

  if (
    resources.materials < materials ||
    resources.wealth < wealth ||
    (mana != null && resources.mana < mana)
  ) {
    return {
      ok: false,
      cost: { materials, wealth, mana },
    };
  }

  return {
    ok: true,
    cost: { materials, wealth, mana },
  };
}

export function buildBuildingForPlayer(
  deps: CityDevelopmentDeps,
  playerId: string,
  kind: BuildingKind,
  now: Date
): BuildBuildingResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  const base = BUILDING_BASE_COST[kind];
  if (!base) {
    return { status: "unknown_kind", message: "Unknown building kind" };
  }

  deps.tickPlayerState?.(ps, now);

  if (ps.city.buildings.length >= ps.city.maxBuildingSlots) {
    return {
      status: "no_slots",
      message: "No free building slots available.",
    };
  }

  const affordability = canAffordBuilding(ps.resources, base, 1);
  if (!affordability.ok) {
    const c = affordability.cost;
    return {
      status: "insufficient_resources",
      message: `Need ${c.materials} materials, ${c.wealth} wealth${
        c.mana ? ` and ${c.mana} mana` : ""
      } to construct this building.`,
    };
  }

  const cost = affordability.cost;
  ps.resources.materials -= cost.materials;
  ps.resources.wealth -= cost.wealth;
  if (cost.mana) {
    ps.resources.mana -= cost.mana;
  }

  const index = ps.city.buildings.length + 1;
  const name = `${base.niceName} ${index}`;

  const building = {
    id: `bld_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    kind,
    level: 1,
    name,
  };

  ps.city.buildings.push(building as any);

  deps.pushEvent(ps, {
    kind: "building_constructed",
    message: `Constructed ${name}`,
  });

  return {
    status: "ok",
    building,
    resources: ps.resources,
  };
}

export function upgradeBuildingForPlayer(
  deps: CityDevelopmentDeps,
  playerId: string,
  buildingId: string,
  now: Date
): UpgradeBuildingResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  deps.tickPlayerState?.(ps, now);

  const building = ps.city.buildings.find((b: any) => b.id === buildingId) as
    | { id: string; name: string; kind: BuildingKind; level: number }
    | undefined;

  if (!building) {
    return { status: "not_found", message: "Building not found" };
  }

  const base = BUILDING_BASE_COST[building.kind];
  if (!base) {
    return {
      status: "unknown_kind",
      message: "Unknown building kind on existing building",
    };
  }

  const nextLevel = building.level + 1;
  const affordability = canAffordBuilding(ps.resources, base, nextLevel);
  if (!affordability.ok) {
    const c = affordability.cost;
    return {
      status: "insufficient_resources",
      message: `Need ${c.materials} materials, ${c.wealth} wealth${
        c.mana ? ` and ${c.mana} mana` : ""
      } to upgrade this building.`,
    };
  }

  const cost = affordability.cost;
  ps.resources.materials -= cost.materials;
  ps.resources.wealth -= cost.wealth;
  if (cost.mana) {
    ps.resources.mana -= cost.mana;
  }

  building.level = nextLevel;

  deps.pushEvent(ps, {
    kind: "building_upgraded",
    message: `Upgraded ${building.name} to level ${building.level}`,
  });

  return {
    status: "ok",
    building,
    resources: ps.resources,
  };
}

function buildResearchState(tech: TechDefinition, now: Date): ActiveResearch {
  return {
    techId: tech.id,
    progress: 0,
    startedAt: now.toISOString(),
  };
}

export function startResearchForPlayer(
  deps: CityDevelopmentDeps,
  playerId: string,
  techId: string,
  now: Date
): StartResearchResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  const tech = getTechById(techId);
  if (!tech) {
    return { status: "unknown_tech", message: "Tech not found" };
  }

  if (ps.researchedTechIds.includes(techId)) {
    return {
      status: "already_researched",
      message: "Technology already researched",
    };
  }

  if (ps.activeResearch) {
    if (ps.activeResearch.techId === techId) {
      return {
        status: "already_researching",
        message: "Technology already being researched",
        research: ps.activeResearch,
      };
    }
    return {
      status: "already_researching",
      message: "Another research project is already in progress",
    };
  }

  const active = buildResearchState(tech, now);
  ps.activeResearch = active;

  deps.pushEvent(ps, {
    kind: "tech_start",
    message: `Research started: ${tech.name}`,
    techId: tech.id,
  });

  return { status: "ok", research: active };
}
