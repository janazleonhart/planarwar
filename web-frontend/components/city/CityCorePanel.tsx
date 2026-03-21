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

type CitySetupChoicePreview = {
  foundingResources: Record<string, number>;
  foundingStats: Record<string, number>;
  passivePerTick: Record<string, number>;
  pressureFloor: {
    stage: "stable" | "strained";
    total: number;
    threatPressure: number;
    unityPressure: number;
  };
  runtimeAccess?: string[];
};

type CitySetupChoiceDetails = {
  id: "city" | "black_market";
  label: string;
  summary: string;
  posture?: string;
  preview?: CitySetupChoicePreview;
  responseFocus?: {
    preferredActionLanes?: string[];
    advisoryTone?: string;
    recommendedOpening?: string;
  };
};


const SETTLEMENT_LANE_TONES: Record<"city" | "black_market", { cardBg: string; activeBg: string; border: string; chipBg: string; chipText: string; }> = {
  city: {
    cardBg: "#101716",
    activeBg: "#14211f",
    border: "#4d7f74",
    chipBg: "#17312c",
    chipText: "#bfe8dc",
  },
  black_market: {
    cardBg: "#181112",
    activeBg: "#241517",
    border: "#8b5458",
    chipBg: "#3a1d20",
    chipText: "#ffd7db",
  },
};

const DEFAULT_CITY_SETUP_CHOICES: CitySetupChoiceDetails[] = [
  {
    id: "city",
    label: "City",
    summary: "Orderly civic growth with formal desks and visible administration.",
  },
  {
    id: "black_market",
    label: "Black Market",
    summary: "A shadow-rooted start for players who want deniable leverage and illicit opportunity.",
  },
];

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
  const citySetupChoices: CitySetupChoiceDetails[] = ((me.citySetupChoices as unknown as CitySetupChoiceDetails[] | undefined) ?? DEFAULT_CITY_SETUP_CHOICES);

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
                  {citySetupChoices.map((choice) => {
                    const active = citySetupLane === choice.id;
                    const tone = SETTLEMENT_LANE_TONES[choice.id];
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={() => setCitySetupLane(choice.id as "city" | "black_market")}
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: `1px solid ${tone.border}`,
                          boxShadow: active ? `inset 0 0 0 1px ${tone.border}` : "none",
                          background: active ? tone.activeBg : tone.cardBg,
                          color: "#eee",
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.7 : 1,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 4 }}>
                          <div style={{ fontWeight: 700 }}>{choice.label}</div>
                          {choice.posture ? (
                            <span style={{ fontSize: 11, opacity: 0.82, textTransform: "capitalize" }}>{choice.posture}</span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.82 }}>{choice.summary}</div>
                        {choice.responseFocus?.recommendedOpening ? (
                          <div style={{ marginTop: 8 }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: 999,
                                fontSize: 11,
                                background: tone.chipBg,
                                color: tone.chipText,
                              }}
                            >
                              {choice.responseFocus.recommendedOpening}
                            </span>
                          </div>
                        ) : null}
                        {choice.preview ? (
                          <div style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 11, opacity: 0.78 }}>
                            <div>
                              Passive per tick: 
                              {Object.entries(choice.preview.passivePerTick)
                                .filter(([, value]) => Number(value) !== 0)
                                .map(([key, value]) => `${value > 0 ? "+" : ""}${value} ${key}`)
                                .join(", ") || "none"}
                            </div>
                            <div>
                              Pressure floor: {choice.preview.pressureFloor.stage} · total {choice.preview.pressureFloor.total}
                            </div>
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const activeChoice = citySetupChoices.find((choice) => choice.id === citySetupLane);
                  if (!activeChoice?.preview) return null;

                  const renderDeltaList = (values: Record<string, number>) =>
                    Object.entries(values)
                      .filter(([, value]) => Number(value) !== 0)
                      .map(([key, value]) => `${value > 0 ? "+" : ""}${value} ${key}`)
                      .join(", ") || "none";

                  return (
                    <div style={{
                      border: "1px solid #555",
                      borderRadius: 10,
                      padding: "12px 14px",
                      background: citySetupLane === "black_market" ? "#151112" : "#121416",
                      display: "grid",
                      gap: 8,
                    }}>
                      <div style={{ fontWeight: 700 }}>{activeChoice.label} opening preview</div>
                      <div style={{ fontSize: 12, opacity: 0.82 }}>{activeChoice.responseFocus?.recommendedOpening ?? activeChoice.summary}</div>
                      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                        <div>
                          <div style={{ fontSize: 11, opacity: 0.72, textTransform: "uppercase" }}>Founding resources</div>
                          <div style={{ fontSize: 12 }}>{renderDeltaList(activeChoice.preview.foundingResources)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, opacity: 0.72, textTransform: "uppercase" }}>Founding posture</div>
                          <div style={{ fontSize: 12 }}>{renderDeltaList(activeChoice.preview.foundingStats)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, opacity: 0.72, textTransform: "uppercase" }}>Passive per tick</div>
                          <div style={{ fontSize: 12 }}>{renderDeltaList(activeChoice.preview.passivePerTick)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, opacity: 0.72, textTransform: "uppercase" }}>Response doctrine</div>
                          <div style={{ fontSize: 12 }}>{activeChoice.responseFocus?.preferredActionLanes?.join(" → ") || "not surfaced yet"}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        Pressure floor: <strong>{activeChoice.preview.pressureFloor.stage}</strong> · total {activeChoice.preview.pressureFloor.total} · threat {activeChoice.preview.pressureFloor.threatPressure} · unity {activeChoice.preview.pressureFloor.unityPressure}
                      </div>
                      {activeChoice.preview.runtimeAccess?.length ? (
                        <div style={{ fontSize: 12, opacity: 0.78 }}>
                          Runtime access: {activeChoice.preview.runtimeAccess.join(" · ")}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
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
