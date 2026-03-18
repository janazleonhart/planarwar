//web-backend/domain/armies.ts

export type ArmyType = "militia" | "line" | "vanguard";

export type ArmyStatus = "idle" | "on_mission";
export type ArmyResponseRole = "frontline" | "command" | "defense" | "recovery" | "warding" | "recon";

export interface Army {
  id: string;
  cityId: string;
  name: string;
  type: ArmyType;
  power: number; // aggregate combat power
  size: number;  // rough headcount
  readiness: number; // 0-100, current field readiness / morale / supply posture
  upkeep: { wealth: number; materials: number }; // per-tick upkeep hint for UI
  specialties: ArmyResponseRole[];
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
      readiness: 76,
      upkeep: { wealth: 8, materials: 5 },
      specialties: ["defense", "frontline", "recovery"],
      status: "idle",
    },
    {
      id: "army_002",
      cityId,
      name: "First Tempest Vanguard",
      type: "vanguard",
      power: 110,
      size: 250,
      readiness: 88,
      upkeep: { wealth: 11, materials: 7 },
      specialties: ["frontline", "command", "recon"],
      status: "idle",
    },
  ];
}
