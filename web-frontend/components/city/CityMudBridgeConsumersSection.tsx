//web-frontend/components/city/CityMudBridgeConsumersSection.tsx

import type { CSSProperties } from "react";
import type { CityMudBridgeStatusResponse } from "../../lib/api";

type CityMudBridgeConsumersSectionProps = {
  consumers: NonNullable<CityMudBridgeStatusResponse["consumers"]>;
};

type Tone = "calm" | "watch" | "danger";

type ConsumerCard = NonNullable<CityMudBridgeStatusResponse["consumers"]>["vendorSupply"];

const toneStyles: Record<Tone, CSSProperties> = {
  calm: { borderColor: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { borderColor: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { borderColor: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

function getTone(state: string, severity: number): Tone {
  const normalized = state.toLowerCase();
  if (severity >= 3 || ["critical", "crisis", "strained", "scarce", "disrupted"].some((token) => normalized.includes(token))) {
    return "danger";
  }
  if (severity >= 2 || ["watch", "tight", "elevated", "caution"].some((token) => normalized.includes(token))) {
    return "watch";
  }
  return "calm";
}

function formatState(value: string): string {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSeverity(severity: number): string {
  if (severity >= 3) return "High pressure";
  if (severity >= 2) return "Elevated pressure";
  if (severity >= 1) return "Manageable pressure";
  return "Stable";
}

function renderConsumerCard(consumer: ConsumerCard) {
  const tone = getTone(consumer.state, consumer.severity);
  const toneStyle = toneStyles[tone];

  return (
    <div
      key={consumer.key}
      style={{
        border: `1px solid ${typeof toneStyle.borderColor === "string" ? toneStyle.borderColor : "#555"}`,
        background: typeof toneStyle.background === "string" ? toneStyle.background : undefined,
        borderRadius: 10,
        padding: 10,
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "grid", gap: 3 }}>
        <div style={{ fontSize: 12, opacity: 0.72 }}>{consumer.label}</div>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{formatState(consumer.state)}</div>
        <div style={{ fontSize: 12, opacity: 0.76 }}>{formatSeverity(consumer.severity)}</div>
      </div>

      <div style={{ fontSize: 13, opacity: 0.86 }}>{consumer.headline}</div>
      <div style={{ fontSize: 12, opacity: 0.78 }}>{consumer.detail}</div>
      <div style={{ fontSize: 12, opacity: 0.74 }}>
        <strong>Desk recommendation:</strong> {consumer.recommendedAction}
      </div>
    </div>
  );
}

export function CityMudBridgeConsumersSection({ consumers }: CityMudBridgeConsumersSectionProps) {
  const liveConsumers = [consumers.vendorSupply, consumers.missionBoard, consumers.civicServices];

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <strong>Live consequence desks</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          These are the city-facing desks already feeling the bridge posture. Read them less like admin telemetry and more like a quick answer to where the strain is showing up first.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
        {liveConsumers.map((consumer) => renderConsumerCard(consumer))}
      </div>

      <div style={{ display: "grid", gap: 5 }}>
        <strong>Desk advisories</strong>
        {consumers.advisories.length ? (
          consumers.advisories.map((advisory, index) => (
            <div
              key={`${index}_${advisory}`}
              style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: "8px 10px", fontSize: 12, opacity: 0.8 }}
            >
              {advisory}
            </div>
          ))
        ) : (
          <div style={{ border: "1px dashed #666", borderRadius: 8, padding: "8px 10px", fontSize: 12, opacity: 0.76 }}>
            No extra advisories are pressing right now. The bridge is giving the city a stable read instead of a panic memo.
          </div>
        )}
      </div>
    </div>
  );
}
