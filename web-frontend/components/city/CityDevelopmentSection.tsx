//web-frontend/components/city/CityDevelopmentSection.tsx

import type { CSSProperties } from "react";
import type { CityBuilding, InfrastructureMode, PublicServiceQuote, Resources } from "../../lib/api";

type CityDevelopmentSectionProps = {
  city: {
    buildings: CityBuilding[];
  };
  serviceMode: InfrastructureMode;
  quoteMap: Map<string, PublicServiceQuote>;
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  disabled: boolean;
  getBuildingConstructionCost: (kind: CityBuilding["kind"]) => { materials: number; wealth: number };
  getBuildingUpgradeCost: (building: CityBuilding) => { materials: number; wealth: number };
  handleBuildBuilding: (kind: CityBuilding["kind"]) => void | Promise<void>;
  handleUpgradeBuilding: (buildingId: string) => void | Promise<void>;
};

const buttonStyle = (disabled: boolean): CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #777",
  background: "#111",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
});

export function CityDevelopmentSection({
  city,
  serviceMode,
  quoteMap,
  formatLevy,
  disabled,
  getBuildingConstructionCost,
  getBuildingUpgradeCost,
  handleBuildBuilding,
  handleUpgradeBuilding,
}: CityDevelopmentSectionProps) {
  return (
    <>
      <div style={{ border: "1px solid #555", borderRadius: 8, padding: 12, display: "grid", gap: 8 }}>
        <strong>Construct building</strong>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Current lane: <strong>{serviceMode}</strong>. Build quote: {formatLevy(quoteMap.get("building_construct")?.levy)} / +{quoteMap.get("building_construct")?.queueMinutes ?? 0}m
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(["housing", "farmland", "mine", "arcane_spire"] as const).map((kind) => {
            const cost = getBuildingConstructionCost(kind);
            return (
              <button
                key={kind}
                style={buttonStyle(disabled)}
                onClick={() => void handleBuildBuilding(kind)}
                title={`Cost: ${cost.materials} materials, ${cost.wealth} wealth`}
                disabled={disabled}
              >
                Build {kind.replace("_", " ")} (m{cost.materials}/w{cost.wealth})
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <strong>Buildings</strong>
        {city.buildings.length === 0 ? (
          <p style={{ opacity: 0.8 }}>No buildings yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {city.buildings.map((building) => {
              const cost = getBuildingUpgradeCost(building);
              return (
                <div key={building.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div>
                    <div><strong>{building.name}</strong> ({building.kind})</div>
                    <div style={{ opacity: 0.85 }}>Level: {building.level}</div>
                  </div>
                  <button
                    style={buttonStyle(disabled)}
                    onClick={() => void handleUpgradeBuilding(building.id)}
                    title={`Cost: ${cost.materials} materials, ${cost.wealth} wealth`}
                    disabled={disabled}
                  >
                    Upgrade (m{cost.materials}/w{cost.wealth})
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
