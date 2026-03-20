//web-frontend/components/city/PublicInfrastructureSummarySection.tsx

import type { CSSProperties } from "react";
import type { PublicInfrastructureStatusResponse } from "../../lib/api";

type PublicInfrastructureSummarySectionProps = {
  infraStatus: PublicInfrastructureStatusResponse | null;
};

type Tone = "calm" | "watch" | "danger";

type SummaryCard = {
  label: string;
  value: string;
  hint: string;
  tone: Tone;
};

const toneStyles: Record<Tone, CSSProperties> = {
  calm: { borderColor: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { borderColor: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { borderColor: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

function getBandTone(value: string): Tone {
  const normalized = value.toLowerCase();
  if (["crisis", "severe", "high", "red", "critical"].some((token) => normalized.includes(token))) return "danger";
  if (["strained", "watch", "medium", "elevated", "amber"].some((token) => normalized.includes(token))) return "watch";
  return "calm";
}

export function PublicInfrastructureSummarySection({
  infraStatus,
}: PublicInfrastructureSummarySectionProps) {
  const infraSummary = infraStatus?.summary ?? null;

  if (!infraSummary) {
    return (
      <div style={{ border: "1px dashed #666", borderRadius: 8, padding: "10px 12px", fontSize: 13, opacity: 0.76 }}>
        No public infrastructure profile is posted yet. Once the civic lanes report in, this desk will show whether permits and services are easing pressure or quietly making more of it.
      </div>
    );
  }

  const cards: SummaryCard[] = [
    {
      label: "Permit lane",
      value: infraSummary.permitTier,
      hint: `recommended mode ${infraSummary.recommendedMode}`,
      tone: getBandTone(infraSummary.permitTier),
    },
    {
      label: "Service strain",
      value: infraSummary.strainBand,
      hint: `heat ${infraSummary.serviceHeat} • queue ${infraSummary.queuePressure}`,
      tone: getBandTone(infraSummary.strainBand),
    },
    {
      label: "City stress link",
      value: `${infraSummary.cityStressStage}`,
      hint: `stress total ${infraSummary.cityStressTotal}`,
      tone: getBandTone(infraSummary.cityStressStage),
    },
    {
      label: "Novice subsidy",
      value: `${infraSummary.subsidyCreditsRemaining}`,
      hint: infraSummary.subsidyCreditsRemaining > 0 ? "remaining public help credits" : "no subsidy cushion remains",
      tone: infraSummary.subsidyCreditsRemaining > 0 ? "calm" : "watch",
    },
  ];

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <strong>Public service desk summary</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          This lane is meant to tell you whether the civic desks are carrying the city cleanly, slowing it down, or quietly building the next queue problem.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        {cards.map((card) => {
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
              <div style={{ fontSize: 18, fontWeight: 700, textTransform: card.label === "City stress link" ? "capitalize" : undefined }}>
                {card.value}
              </div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>{card.hint}</div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 13, opacity: 0.85 }}>{infraSummary.note}</div>
    </div>
  );
}
