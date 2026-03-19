//web-frontend/components/city/CityResourcesCard.tsx

import type { CSSProperties } from "react";
import type { CitySummary, MeProfile, Resources } from "../../lib/api";
import { formatProductionDelta, summarizeTreasury } from "./cityPolishSummaries";

interface CityResourcesCardProps {
  resources: Resources;
  city: CitySummary | null;
  cityStress: MeProfile["cityStress"];
  cardStyle: (extra?: CSSProperties) => CSSProperties;
}

const resourceMeta: Array<{
  key: keyof Resources;
  label: string;
  group: "supply" | "treasury" | "civic";
  tone: "calm" | "watch" | "danger";
}> = [
  { key: "food", label: "Food", group: "supply", tone: "calm" },
  { key: "materials", label: "Materials", group: "supply", tone: "watch" },
  { key: "wealth", label: "Wealth", group: "treasury", tone: "calm" },
  { key: "mana", label: "Mana", group: "treasury", tone: "watch" },
  { key: "knowledge", label: "Knowledge", group: "civic", tone: "calm" },
  { key: "unity", label: "Unity", group: "civic", tone: "watch" },
];

const tonePalette = {
  calm: { border: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { border: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { border: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

export function CityResourcesCard({ resources, city, cityStress, cardStyle }: CityResourcesCardProps) {
  const summary = summarizeTreasury(resources, cityStress);
  const grouped = {
    supply: resourceMeta.filter((item) => item.group === "supply"),
    treasury: resourceMeta.filter((item) => item.group === "treasury"),
    civic: resourceMeta.filter((item) => item.group === "civic"),
  };

  return (
    <div style={cardStyle({ gap: 12 })}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
          Resource command summary
        </div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{summary.headline}</div>
        <div style={{ fontSize: 13, opacity: 0.82 }}>{summary.detail}</div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {([
          ["supply", "Supply lanes"],
          ["treasury", "Treasury and arcana"],
          ["civic", "Knowledge and cohesion"],
        ] as const).map(([groupKey, title]) => (
          <div key={groupKey} style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.68 }}>{title}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              {grouped[groupKey].map((item) => {
                const palette = tonePalette[item.tone];
                return (
                  <div
                    key={item.key}
                    style={{
                      border: `1px solid ${palette.border}`,
                      background: palette.background,
                      borderRadius: 10,
                      padding: 10,
                      display: "grid",
                      gap: 3,
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.72 }}>{item.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{resources[item.key]}</div>
                    <div style={{ fontSize: 12, opacity: 0.76 }}>{formatProductionDelta(city, item.key)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
