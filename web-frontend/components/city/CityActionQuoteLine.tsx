//web-frontend/components/city/CityActionQuoteLine.tsx

import type { CSSProperties } from "react";
import type { PublicServiceQuote, Resources } from "../../lib/api";

type CityActionQuoteLineProps = {
  label: string;
  quote: PublicServiceQuote | undefined;
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  prefix?: string;
};

const chipStyle = (tone: "calm" | "watch"): CSSProperties => ({
  border: `1px solid ${tone === "watch" ? "#77603a" : "#355d45"}`,
  background: tone === "watch" ? "rgba(90,70,30,0.16)" : "rgba(30,70,40,0.16)",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 12,
  opacity: 0.9,
});

export function CityActionQuoteLine({
  label,
  quote,
  formatLevy,
  prefix,
}: CityActionQuoteLineProps) {
  const levyLabel = formatLevy(quote?.levy);
  const queueMinutes = quote?.queueMinutes ?? 0;
  const queueTone = queueMinutes >= 30 ? "watch" : "calm";

  return (
    <div
      style={{
        border: "1px solid #444",
        borderRadius: 8,
        padding: "8px 10px",
        display: "grid",
        gap: 6,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{label}</strong>
        <span style={chipStyle("calm")}>Levy {levyLabel}</span>
        <span style={chipStyle(queueTone)}>Queue +{queueMinutes}m</span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        {prefix ?? "Current desk estimate."} {quote
          ? "Use this as the expected civic cost before you commit the order."
          : "No live quote is posted yet, so this desk is carrying the standing read until the lane reports in."}
      </div>
    </div>
  );
}
