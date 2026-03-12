//web-backend/gameState/gameStateArmies.ts

import type { Army, ArmyType } from "../domain/armies";
import type { GameEventInput, PlayerState, Resources } from "../gameState";

export interface RaiseArmyResult {
  status: "ok" | "not_found" | "invalid_type" | "insufficient_resources";
  message?: string;
  army?: Army;
  resources?: Resources;
}

export interface ReinforceArmyResult {
  status: "ok" | "not_found" | "insufficient_resources" | "not_idle";
  message?: string;
  army?: Army;
  resources?: Resources;
}

export interface ArmyStateDeps {
  getPlayerState(playerId: string): PlayerState | undefined;
  tickPlayerState?(ps: PlayerState, now: Date): void;
  pushEvent(ps: PlayerState, input: GameEventInput): void;
}

const ARMY_BASE_CONFIG: Record<
  ArmyType,
  { baseSize: number; basePower: number; baseMaterials: number; baseWealth: number }
> = {
  militia: {
    baseSize: 100,
    basePower: 60,
    baseMaterials: 80,
    baseWealth: 40,
  },
  line: {
    baseSize: 150,
    basePower: 100,
    baseMaterials: 130,
    baseWealth: 80,
  },
  vanguard: {
    baseSize: 80,
    basePower: 140,
    baseMaterials: 160,
    baseWealth: 120,
  },
};

function buildArmyName(type: ArmyType, index: number): string {
  const nameBase =
    type === "militia"
      ? "Militia Cohort"
      : type === "line"
      ? "Line Regiment"
      : "Vanguard Spear";

  return `${nameBase} ${index}`;
}

export function raiseArmyForPlayer(
  deps: ArmyStateDeps,
  playerId: string,
  type: ArmyType,
  now: Date
): RaiseArmyResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  const cfg = ARMY_BASE_CONFIG[type];
  if (!cfg) {
    return { status: "invalid_type", message: "Unknown army type" };
  }

  deps.tickPlayerState?.(ps, now);

  const tierMult = 1 + (ps.city.tier - 1) * 0.25;
  const size = Math.round(cfg.baseSize * tierMult);
  const power = Math.round(cfg.basePower * tierMult);
  const materialsCost = Math.round(cfg.baseMaterials * tierMult);
  const wealthCost = Math.round(cfg.baseWealth * tierMult);

  if (ps.resources.materials < materialsCost || ps.resources.wealth < wealthCost) {
    return {
      status: "insufficient_resources",
      message: `Need ${materialsCost} materials and ${wealthCost} wealth to raise this army.`,
    };
  }

  ps.resources.materials -= materialsCost;
  ps.resources.wealth -= wealthCost;

  const army: Army = {
    id: `army_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    cityId: ps.city.id,
    name: buildArmyName(type, ps.armies.length + 1),
    type,
    power,
    size,
    status: "idle",
  };

  ps.armies.push(army);

  deps.pushEvent(ps, {
    kind: "army_raised",
    message: `Raised ${army.name} (${army.type})`,
    armyId: army.id,
  });

  return {
    status: "ok",
    army,
    resources: ps.resources,
  };
}

export function reinforceArmyForPlayer(
  deps: ArmyStateDeps,
  playerId: string,
  armyId: string,
  now: Date
): ReinforceArmyResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  deps.tickPlayerState?.(ps, now);

  const army = ps.armies.find((entry) => entry.id === armyId);
  if (!army) {
    return { status: "not_found", message: "Army not found" };
  }

  if (army.status !== "idle") {
    return {
      status: "not_idle",
      message: "Army must be idle to be reinforced.",
    };
  }

  const deltaSize = Math.max(30, Math.round(army.size * 0.3));
  const materialsCost = Math.round(deltaSize * 0.6);
  const wealthCost = Math.round(deltaSize * 0.35);

  if (ps.resources.materials < materialsCost || ps.resources.wealth < wealthCost) {
    return {
      status: "insufficient_resources",
      message: `Need ${materialsCost} materials and ${wealthCost} wealth to reinforce this army.`,
    };
  }

  ps.resources.materials -= materialsCost;
  ps.resources.wealth -= wealthCost;

  army.size += deltaSize;
  const deltaPower = Math.max(10, Math.round(army.power * 0.25));
  army.power += deltaPower;

  deps.pushEvent(ps, {
    kind: "army_reinforced",
    message: `Reinforced ${army.name} by ${deltaSize} troops`,
    armyId: army.id,
  });

  return {
    status: "ok",
    army,
    resources: ps.resources,
  };
}
