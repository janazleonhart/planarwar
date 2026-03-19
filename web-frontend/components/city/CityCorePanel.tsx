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
import { CityOverviewSection } from "./CityOverviewSection";

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

          <div style={{ display: "grid", gap: 8 }}>
            <strong>Heroes</strong>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Recruit quote: {formatLevy(quoteMap.get("hero_recruit")?.levy)} / +{quoteMap.get("hero_recruit")?.queueMinutes ?? 0}m
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(["champion", "scout", "tactician", "mage"] as const).map((role) => (
                <button
                  key={role}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                  disabled={disabled}
                  onClick={() => void handleRecruitHero(role)}
                >
                  Recruit {role}
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {me.heroes.map((hero) => (
                <div key={hero.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
                  <div><strong>{hero.name}</strong> ({hero.role}) • power {hero.power} • {hero.status}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Response roles: {hero.responseRoles?.join(", ") || "generalist"}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(hero.traits ?? []).map((trait) => (
                      <span key={trait.id} style={{ border: `1px solid ${trait.polarity === "pro" ? "#2a6" : "#844"}`, borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.9 }} title={trait.summary}>
                        {trait.polarity === "pro" ? "+" : "−"} {trait.name}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, opacity: 0.82 }}>Gear:</div>
                    {(hero.attachments?.length ?? 0) === 0 ? (
                      <div style={{ fontSize: 12, opacity: 0.62 }}>No gear equipped.</div>
                    ) : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(hero.attachments ?? []).map((attachment) => (
                          <span key={attachment.id} style={{ border: "1px solid #446", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.92 }} title={attachment.summary ?? `${attachment.family} gear`}>
                            {attachment.name} • {attachment.slot} • {(attachment.responseTags ?? []).join("/")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {(["valor_charm", "scouting_cloak", "arcane_focus"] as const).map((kind) => (
                      <button
                        key={kind}
                        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                        disabled={disabled}
                        onClick={() => void handleEquipHeroAttachment(hero.id, kind)}
                        title={kind === "valor_charm" ? "Trinket slot • frontline/recovery" : kind === "scouting_cloak" ? "Utility slot • recon/recovery" : "Focus slot • warding/command"}
                      >
                        Equip {kind}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <strong>Workshop</strong>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Craft quote: {formatLevy(quoteMap.get("workshop_craft")?.levy)} / +{quoteMap.get("workshop_craft")?.queueMinutes ?? 0}m
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(["valor_charm", "scouting_cloak", "arcane_focus"] as const).map((kind) => (
                <button
                  key={kind}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                  disabled={disabled}
                  onClick={() => void handleWorkshopCraft(kind)}
                >
                  Craft {kind}
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {me.workshopJobs.map((job) => (
                <div key={job.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div>
                    <div><strong>{job.attachmentKind}</strong></div>
                    <div style={{ opacity: 0.8, fontSize: 13 }}>Finishes: {new Date(job.finishesAt).toLocaleString()} • {job.completed ? "completed" : "in progress"}</div>
                  </div>
                  <button
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                    disabled={disabled || !job.completed}
                    onClick={() => void handleWorkshopCollect(job.id)}
                  >
                    Collect
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <strong>Tech</strong>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Research quote: {formatLevy(quoteMap.get("tech_research")?.levy)} / +{quoteMap.get("tech_research")?.queueMinutes ?? 0}m
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {techOptions.map((tech) => (
                <button
                  key={tech.id}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                  disabled={disabled}
                  onClick={() => void handleStartTech(tech.id)}
                  title={tech.description ?? tech.id}
                >
                  Start: {tech.name}
                </button>
              ))}
              {!techOptions.length ? <span style={{ opacity: 0.7, fontSize: 13 }}>No tech options (yet).</span> : null}
            </div>
            {me.activeResearch ? <div style={{ fontSize: 13, opacity: 0.85 }}>Active research: {me.activeResearch.name} ({me.activeResearch.progress}/{me.activeResearch.cost})</div> : null}
          </div>
        </>
      )}
    </div>
  );
}
