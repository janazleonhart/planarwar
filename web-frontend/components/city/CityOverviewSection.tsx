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

type Tone = "calm" | "watch" | "danger";

type OverviewCard = {
  label: string;
  value: string;
  hint: string;
  tone: Tone;
};

const detailGridStyle: CSSProperties = { display: "grid", gap: 10 };
const sectionStyle: CSSProperties = { display: "grid", gap: 8 };
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

const toneStyles: Record<Tone, CSSProperties> = {
  calm: { borderColor: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { borderColor: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { borderColor: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

function getSlotTone(used: number, max: number): Tone {
  if (max <= 0) return "danger";
  const ratio = used / max;
  if (ratio >= 0.9) return "danger";
  if (ratio >= 0.7) return "watch";
  return "calm";
}

function getTierTone(tier: number): Tone {
  if (tier >= 4) return "calm";
  if (tier >= 2) return "watch";
  return "danger";
}

function formatSpecializationLabel(city: NonNullable<MeProfile["city"]>): string {
  return city.specializationId
    ? `${city.specializationId.replace(/_/g, " ")} ★${city.specializationStars}`
    : "Unspecialized";
}

export function CityOverviewSection({
  city,
  me,
  cityNameDraft,
  setCityNameDraft,
  disabled,
  handleRenameCity,
  handleTierUpCity,
}: CityOverviewSectionProps) {
  const overviewCards: OverviewCard[] = [
    {
      label: "Region desk",
      value: getRegionDisplayName(city.regionId),
      hint: city.regionId,
      tone: "calm",
    },
    {
      label: "Tier standing",
      value: `Tier ${city.tier}`,
      hint: city.tier >= 4 ? "well-established city posture" : city.tier >= 2 ? "developing city posture" : "still in early growth",
      tone: getTierTone(city.tier),
    },
    {
      label: "Specialization",
      value: formatSpecializationLabel(city),
      hint: city.specializationId ? "current city doctrine" : "no civic doctrine locked yet",
      tone: city.specializationId ? "calm" : "watch",
    },
    {
      label: "Build capacity",
      value: `${city.buildingSlotsUsed}/${city.buildingSlotsMax}`,
      hint: city.buildingSlotsUsed >= city.buildingSlotsMax ? "construction capacity capped" : "expansion room remains",
      tone: getSlotTone(city.buildingSlotsUsed, city.buildingSlotsMax),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <strong>City overview desk</strong>
        <div style={{ fontSize: 13, opacity: 0.78 }}>
          Identity, civic posture, and administrative controls for the city itself. This is the ruler-facing summary lane, not the place for scavenger hunts.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
        {overviewCards.map((card) => {
          const toneStyle = toneStyles[card.tone];
          return (
            <div
              key={card.label}
              style={{
                border: `1px solid ${typeof toneStyle.borderColor === "string" ? toneStyle.borderColor : "#555"}`,
                background: typeof toneStyle.background === "string" ? toneStyle.background : undefined,
                borderRadius: 10,
                padding: 10,
                display: "grid",
                gap: 3,
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.72 }}>{card.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{card.value}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>{card.hint}</div>
            </div>
          );
        })}
      </div>

      <div style={detailGridStyle}>
        <div style={{ display: "grid", gap: 4 }}>
          <strong>Administrative record</strong>
          <div><strong>ID:</strong> {city.id}</div>
          <div><strong>Shard:</strong> {city.shardId}</div>
          <div><strong>Region:</strong> {getRegionDisplayName(city.regionId)} <span style={{ opacity: 0.7 }}>({city.regionId})</span></div>
        </div>

        <label style={{ display: "grid", gap: 6, maxWidth: 420 }}>
          <span><strong>City naming desk</strong></span>
          <div style={{ fontSize: 12, opacity: 0.74 }}>
            Rename the city without leaving the command board. Demo profiles stay read-only here.
          </div>
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
                Rename city
              </button>
            ) : null}
          </div>
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            style={actionButtonStyle(disabled)}
            onClick={() => void handleTierUpCity()}
            disabled={disabled}
          >
            Advance city tier
          </button>
          <div style={{ fontSize: 12, opacity: 0.74 }}>
            Use this when the city is ready to climb, not merely because the button exists and mocked you.
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <strong>Settlement lane desk</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          The founding lane this settlement lives under. Read this as the standing doctrine for how the city answers pressure before later UI splits turn City and Black Market into their own full surfaces.
        </div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div style={{
            border: "1px solid #555",
            borderRadius: 10,
            padding: 10,
            display: "grid",
            gap: 4,
            background: city.settlementLane === "black_market" ? "rgba(70,25,30,0.16)" : "rgba(30,55,75,0.14)",
          }}>
            <div style={{ fontSize: 12, opacity: 0.72 }}>Lane posture</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{city.settlementLaneProfile.label}</div>
            <div style={{ fontSize: 12, opacity: 0.82 }}>{city.settlementLaneProfile.posture}</div>
            <div style={{ fontSize: 12, opacity: 0.76 }}>{city.settlementLaneProfile.summary}</div>
          </div>
          <div style={{
            border: "1px solid #555",
            borderRadius: 10,
            padding: 10,
            display: "grid",
            gap: 4,
          }}>
            <div style={{ fontSize: 12, opacity: 0.72 }}>Response doctrine</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{city.settlementLaneProfile.responseFocus.advisoryTone}</div>
            <div style={{ fontSize: 12 }}>{city.settlementLaneProfile.responseFocus.preferredActionLanes.join(" → ")}</div>
            <div style={{ fontSize: 12, opacity: 0.76 }}>{city.settlementLaneProfile.responseFocus.recommendedOpening}</div>
          </div>
          <div style={{
            border: "1px solid #555",
            borderRadius: 10,
            padding: 10,
            display: "grid",
            gap: 4,
          }}>
            <div style={{ fontSize: 12, opacity: 0.72 }}>Lane contribution</div>
            <div style={{ fontSize: 12 }}>
              Food {city.productionBreakdown.settlementLane.foodPerTick >= 0 ? "+" : ""}{city.productionBreakdown.settlementLane.foodPerTick} · Materials {city.productionBreakdown.settlementLane.materialsPerTick >= 0 ? "+" : ""}{city.productionBreakdown.settlementLane.materialsPerTick}
            </div>
            <div style={{ fontSize: 12 }}>
              Wealth {city.productionBreakdown.settlementLane.wealthPerTick >= 0 ? "+" : ""}{city.productionBreakdown.settlementLane.wealthPerTick} · Mana {city.productionBreakdown.settlementLane.manaPerTick >= 0 ? "+" : ""}{city.productionBreakdown.settlementLane.manaPerTick}
            </div>
            <div style={{ fontSize: 12 }}>
              Knowledge {city.productionBreakdown.settlementLane.knowledgePerTick >= 0 ? "+" : ""}{city.productionBreakdown.settlementLane.knowledgePerTick} · Unity {city.productionBreakdown.settlementLane.unityPerTick >= 0 ? "+" : ""}{city.productionBreakdown.settlementLane.unityPerTick}
            </div>
          </div>
        </div>
        <div style={{
          border: "1px dashed #666",
          borderRadius: 10,
          padding: 10,
          display: "grid",
          gap: 4,
        }}>
          <div style={{ fontSize: 12, opacity: 0.72 }}>{city.settlementLaneLatestReceipt.title}</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{city.settlementLaneReceipt.title}</div>
          <div style={{ fontSize: 12 }}>{city.settlementLaneLatestReceipt.message}</div>
          <div style={{ fontSize: 11, opacity: 0.68 }}>{city.settlementLaneLatestReceipt.kind} · {new Date(city.settlementLaneLatestReceipt.timestamp).toLocaleString()}</div>
        </div>
      </div>

      <div style={sectionStyle}>
        <strong>City stat ledger</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          Core city ratings that influence resilience, growth, and how much punishment this place can absorb before it starts making your life interesting.
        </div>
        <ul style={listStyle}>
          <li>Population: {city.stats.population}</li>
          <li>Stability: {city.stats.stability}</li>
          <li>Prosperity: {city.stats.prosperity}</li>
          <li>Security: {city.stats.security}</li>
          <li>Infrastructure: {city.stats.infrastructure}</li>
          <li>Arcane saturation: {city.stats.arcaneSaturation}</li>
          <li>Influence: {city.stats.influence}</li>
          <li>Unity: {city.stats.unity}</li>
        </ul>
      </div>

      <div style={sectionStyle}>
        <strong>Per-tick production ledger</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          Passive output from the current city state. This is the quiet stream feeding the rest of the board, for better or worse.
        </div>
        <ul style={listStyle}>
          <li>Food: {city.production.foodPerTick}</li>
          <li>Materials: {city.production.materialsPerTick}</li>
          <li>Wealth: {city.production.wealthPerTick}</li>
          <li>Mana: {city.production.manaPerTick}</li>
          <li>Knowledge: {city.production.knowledgePerTick}</li>
          <li>Unity: {city.production.unityPerTick}</li>
        </ul>
      </div>
    </div>
  );
}
