//backend/src/domain/armies.ts

export type ArmyType = "militia" | "line" | "vanguard";

export type ArmyStatus = "idle" | "on_mission";

export interface Army {
  id: string;
  cityId: string;
  name: string;
  type: ArmyType;
  power: number; // aggregate combat power
  size: number;  // rough headcount
  status: ArmyStatus;
  currentMissionId?: string;
}

export function seedStarterArmies(cityId: string): Army[] {
  return [
    {
      id: "army_001",
      cityId,
      name: "Prime Bastion Guard",
      type: "militia",
      power: 60,
      size: 400,
      status: "idle",
    },
    {
      id: "army_002",
      cityId,
      name: "First Tempest Vanguard",
      type: "vanguard",
      power: 110,
      size: 250,
      status: "idle",
    },
  ];
}
