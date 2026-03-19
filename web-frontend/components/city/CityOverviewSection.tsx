//web-frontend/components/city/CityOverviewSection.tsx

import type { CSSProperties } from "react";
import type { MeProfile } from "../../lib/api";
import { getRegionDisplayName } from "../worldResponse/worldResponseUi";

type CityOverviewSectionProps = {
  city: NonNullable<MeProfile["city"]>;
  me: MeProfile;
  cityNameDraft: string;
  setCityNameDraft: (value: string) => void;
  disabled: boolean;
  handleRenameCity: () => void | Promise<void>;
  handleTierUpCity: () => void | Promise<void>;
};

const detailGridStyle: CSSProperties = { display: "grid", gap: 4 };
const sectionStyle: CSSProperties = { display: "grid", gap: 6 };
const listStyle: CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 14 };
const actionButtonStyle = (disabled: boolean): CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #777",
  background: "#111",
  cursor: disabled ? "not-allowed" : "pointer",
  width: "fit-content",
  opacity: disabled ? 0.6 : 1,
});

export function CityOverviewSection({
  city,
  me,
  cityNameDraft,
  setCityNameDraft,
  disabled,
  handleRenameCity,
  handleTierUpCity,
}: CityOverviewSectionProps) {
  return (
    <>
      <div style={detailGridStyle}>
        <div><strong>ID:</strong> {city.id}</div>
        <div><strong>Shard:</strong> {city.shardId}</div>
        <div><strong>Region:</strong> {getRegionDisplayName(city.regionId)} <span style={{ opacity: 0.7 }}>({city.regionId})</span></div>
        <div><strong>Tier:</strong> {city.tier}</div>
        <div><strong>Specialization:</strong> {city.specializationId ? `${city.specializationId} (★${city.specializationStars})` : "None"}</div>
        <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
          <span><strong>City name</strong></span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={cityNameDraft}
              onChange={(e) => setCityNameDraft(e.target.value)}
              maxLength={24}
              disabled={!!me.isDemo}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid #666",
                background: "#111",
                color: "#eee",
                minWidth: 220,
              }}
            />
            {!me.isDemo ? (
              <button
                onClick={() => void handleRenameCity()}
                disabled={disabled || cityNameDraft.trim().length < 3 || cityNameDraft.trim() === city.name}
                style={actionButtonStyle(disabled)}
              >
                Rename City
              </button>
            ) : null}
          </div>
        </label>

        <div><strong>Slots:</strong> {city.buildingSlotsUsed} / {city.buildingSlotsMax}</div>
        <button
          style={actionButtonStyle(disabled)}
          onClick={() => void handleTierUpCity()}
          disabled={disabled}
        >
          Tier Up City
        </button>
      </div>

      <div style={sectionStyle}>
        <strong>Stats</strong>
        <ul style={listStyle}>
          <li>Population: {city.stats.population}</li>
          <li>Stability: {city.stats.stability}</li>
          <li>Prosperity: {city.stats.prosperity}</li>
          <li>Security: {city.stats.security}</li>
          <li>Infrastructure: {city.stats.infrastructure}</li>
          <li>Arcane: {city.stats.arcaneSaturation}</li>
          <li>Influence: {city.stats.influence}</li>
          <li>Unity: {city.stats.unity}</li>
        </ul>
      </div>

      <div style={sectionStyle}>
        <strong>Per-tick production</strong>
        <ul style={listStyle}>
          <li>Food: {city.production.foodPerTick}</li>
          <li>Materials: {city.production.materialsPerTick}</li>
          <li>Wealth: {city.production.wealthPerTick}</li>
          <li>Mana: {city.production.manaPerTick}</li>
          <li>Knowledge: {city.production.knowledgePerTick}</li>
          <li>Unity: {city.production.unityPerTick}</li>
        </ul>
      </div>
    </>
  );
}
