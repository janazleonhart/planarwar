//web-frontend/components/city/CityDevelopmentSection.tsx

import { CityActionQuoteLine } from "./CityActionQuoteLine";
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

function formatKindLabel(kind: string) {
  return kind.replace(/_/g, " ");
}

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
        <strong>Construction desk</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          Queue new civic work with the current lane cost already surfaced before you commit the order.
        </div>
        <CityActionQuoteLine
          prefix={`Current lane: ${serviceMode.replace(/_/g, " ")}.`}
          label="Build estimate"
          quote={quoteMap.get("building_construct")}
          formatLevy={formatLevy}
        />
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
                Build {formatKindLabel(kind)} (m{cost.materials}/w{cost.wealth})
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <strong>Building ledger</strong>
          <div style={{ fontSize: 12, opacity: 0.76 }}>
            {city.buildings.length === 0
              ? "No civic structures are standing yet. The founding plan still lives mostly on paper."
              : `${city.buildings.length} active structure${city.buildings.length === 1 ? "" : "s"} ready for review.`}
          </div>
        </div>
        {city.buildings.length === 0 ? (
          <div style={{ border: "1px dashed #666", borderRadius: 8, padding: "10px 12px", fontSize: 13, opacity: 0.78 }}>
            The ledger is still empty. Raise the first district pieces here so the city stops being a charter and starts becoming a place.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {city.buildings.map((building) => {
              const cost = getBuildingUpgradeCost(building);
              return (
                <div key={building.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "grid", gap: 3 }}>
                    <div><strong>{building.name}</strong> ({formatKindLabel(building.kind)})</div>
                    <div style={{ opacity: 0.85 }}>Level {building.level}</div>
                    <div style={{ fontSize: 12, opacity: 0.72 }}>Upgrade estimate: {cost.materials} materials, {cost.wealth} wealth</div>
                  </div>
                  <button
                    style={buttonStyle(disabled)}
                    onClick={() => void handleUpgradeBuilding(building.id)}
                    title={`Cost: ${cost.materials} materials, ${cost.wealth} wealth`}
                    disabled={disabled}
                  >
                    Upgrade
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
