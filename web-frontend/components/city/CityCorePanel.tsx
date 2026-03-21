//web-frontend/components/city/CityCorePanel.tsx

import type { CSSProperties } from "react";
import type {
  CityBuilding,
  HeroRole,
  InfrastructureMode,
  MeProfile,
  PublicServiceQuote,
  Resources,
} from "../../lib/api";
import { CityDevelopmentSection } from "./CityDevelopmentSection";
import { CityHeroSection } from "./CityHeroSection";
import { CityOverviewSection } from "./CityOverviewSection";
import { CityWorkshopTechSection } from "./CityWorkshopTechSection";

type CityCorePanelProps = {
  cardStyle: (extra?: CSSProperties) => CSSProperties;
  me: MeProfile;
  serviceMode: InfrastructureMode;
  cityNameDraft: string;
  setCityNameDraft: (value: string) => void;
  citySetupLane: "city" | "black_market";
  setCitySetupLane: (value: "city" | "black_market") => void;
  disabled: boolean;
  techOptions: NonNullable<MeProfile["availableTechs"]>;
  quoteMap: Map<string, PublicServiceQuote>;
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  getBuildingConstructionCost: (kind: CityBuilding["kind"]) => { materials: number; wealth: number };
  getBuildingUpgradeCost: (building: CityBuilding) => { materials: number; wealth: number };
  handleCreateCity: () => void | Promise<void>;
  handleRenameCity: () => void | Promise<void>;
  handleTierUpCity: () => void | Promise<void>;
  handleBuildBuilding: (kind: CityBuilding["kind"]) => void | Promise<void>;
  handleUpgradeBuilding: (buildingId: string) => void | Promise<void>;
  handleRecruitHero: (role: HeroRole) => void | Promise<void>;
  handleEquipHeroAttachment: (heroId: string, kind: "valor_charm" | "scouting_cloak" | "arcane_focus") => void | Promise<void>;
  handleWorkshopCraft: (kind: "valor_charm" | "scouting_cloak" | "arcane_focus") => void | Promise<void>;
  handleWorkshopCollect: (jobId: string) => void | Promise<void>;
  handleStartTech: (techId: string) => void | Promise<void>;
};

export function CityCorePanel({
  cardStyle,
  me,
  serviceMode,
  cityNameDraft,
  setCityNameDraft,
  citySetupLane,
  setCitySetupLane,
  disabled,
  techOptions,
  quoteMap,
  formatLevy,
  getBuildingConstructionCost,
  getBuildingUpgradeCost,
  handleCreateCity,
  handleRenameCity,
  handleTierUpCity,
  handleBuildBuilding,
  handleUpgradeBuilding,
  handleRecruitHero,
  handleEquipHeroAttachment,
  handleWorkshopCraft,
  handleWorkshopCollect,
  handleStartTech,
}: CityCorePanelProps) {
  const city = me.city ?? null;

  return (
    <div style={cardStyle()}>
      <h3 style={{ marginTop: 0 }}>City</h3>

      {!city ? (
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ opacity: 0.85, margin: 0 }}>
            No city is attached to this profile yet. Founding one here will wake the rest of the board and turn this from paperwork into an actual seat of rule.
          </p>
          {me.canCreateCity ? (
            <>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Choose your founding lane</div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                  {(me.citySetupChoices ?? [
                    { id: "city", label: "City", summary: "Orderly civic growth with formal desks and visible administration." },
                    { id: "black_market", label: "Black Market", summary: "A shadow-rooted start for players who want deniable leverage and illicit opportunity." },
                  ]).map((choice) => {
                    const active = citySetupLane === choice.id;
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={() => setCitySetupLane(choice.id)}
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: active ? "2px solid #777" : "1px solid #666",
                          background: active ? "#161616" : "#111",
                          color: "#eee",
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.7 : 1,
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{choice.label}</div>
                        <div style={{ fontSize: 12, opacity: 0.82 }}>{choice.summary}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <label style={{ display: "grid", gap: 6 }}>
                <span>{citySetupLane === "black_market" ? "Front name" : "City name"}</span>
                <input
                  value={cityNameDraft}
                  onChange={(e) => setCityNameDraft(e.target.value)}
                  maxLength={24}
                  placeholder={me.suggestedCityName ?? "Founder's Hold"}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid #666",
                    background: "#111",
                    color: "#eee",
                  }}
                />
              </label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                3–24 characters. Letters, numbers, spaces, apostrophes, and hyphens only.
                {citySetupLane === "black_market"
                  ? " This starts the settlement on the shadow-market lane; the full split UI comes later."
                  : " This starts the settlement on the civic city lane."}
              </div>
              <button
                onClick={() => void handleCreateCity()}
                disabled={disabled || cityNameDraft.trim().length < 3}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #777",
                  background: "#111",
                  cursor: disabled ? "not-allowed" : "pointer",
                  width: "fit-content",
                  opacity: disabled ? 0.6 : 1,
                }}
              >
                {citySetupLane === "black_market" ? "Found Black Market" : "Create City"}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <CityOverviewSection
            city={city}
            me={me}
            cityNameDraft={cityNameDraft}
            setCityNameDraft={setCityNameDraft}
            disabled={disabled}
            handleRenameCity={handleRenameCity}
            handleTierUpCity={handleTierUpCity}
          />

          <CityDevelopmentSection
            city={city}
            serviceMode={serviceMode}
            quoteMap={quoteMap}
            formatLevy={formatLevy}
            disabled={disabled}
            getBuildingConstructionCost={getBuildingConstructionCost}
            getBuildingUpgradeCost={getBuildingUpgradeCost}
            handleBuildBuilding={handleBuildBuilding}
            handleUpgradeBuilding={handleUpgradeBuilding}
          />

          <CityHeroSection
            me={me}
            disabled={disabled}
            quoteMap={quoteMap}
            formatLevy={formatLevy}
            handleRecruitHero={handleRecruitHero}
            handleEquipHeroAttachment={handleEquipHeroAttachment}
          />

          <CityWorkshopTechSection
            me={me}
            disabled={disabled}
            techOptions={techOptions}
            quoteMap={quoteMap}
            formatLevy={formatLevy}
            handleWorkshopCraft={handleWorkshopCraft}
            handleWorkshopCollect={handleWorkshopCollect}
            handleStartTech={handleStartTech}
          />
        </>
      )}
    </div>
  );
}
