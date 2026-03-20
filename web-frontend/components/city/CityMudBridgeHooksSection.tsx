//web-frontend/components/city/CityMudBridgeHooksSection.tsx

import type { CSSProperties } from "react";
import type { CityMudBridgeStatusResponse } from "../../lib/api";

type CityMudBridgeHooksSectionProps = {
  hooks: NonNullable<CityMudBridgeStatusResponse["summary"]>["hooks"];
};

type Tone = "calm" | "watch" | "danger";

const toneStyles: Record<Tone, CSSProperties> = {
  calm: { borderColor: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { borderColor: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { borderColor: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

function getHookTone(score: number, direction: string): Tone {
  if (score >= 70 || ["down", "strained", "scarcity"].some((token) => direction.toLowerCase().includes(token))) return "danger";
  if (score >= 40) return "watch";
  return "calm";
}

function formatDirection(direction: string): string {
  return direction
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function CityMudBridgeHooksSection({ hooks }: CityMudBridgeHooksSectionProps) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <strong>Bridge pressure lines</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          These lines are not a new subsystem to babysit. They are the short list of world-facing seams already leaning one way or another because of your city posture.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
        {hooks.map((hook) => {
          const toneStyle = toneStyles[getHookTone(hook.score, hook.direction)];
          return (
            <div
              key={hook.key}
              style={{
                border: `1px solid ${typeof toneStyle.borderColor === "string" ? toneStyle.borderColor : "#555"}`,
                background: typeof toneStyle.background === "string" ? toneStyle.background : undefined,
                borderRadius: 10,
                padding: 10,
                display: "grid",
                gap: 5,
              }}
            >
              <div style={{ display: "grid", gap: 3 }}>
                <div style={{ fontSize: 12, opacity: 0.72 }}>{hook.label}</div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{hook.score}</div>
                <div style={{ fontSize: 12, opacity: 0.76 }}>Direction {formatDirection(hook.direction)}</div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{hook.detail}</div>
              <div style={{ fontSize: 12, opacity: 0.74 }}>
                <strong>World effect:</strong> {hook.mudEffect}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
