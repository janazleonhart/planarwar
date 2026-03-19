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
            No city attached to this profile yet. This account can bootstrap one now instead of staring at a sad 404 goblin.
          </p>
          {me.canCreateCity ? (
            <>
              <label style={{ display: "grid", gap: 6 }}>
                <span>City name</span>
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
                Create City
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
