// web-frontend/components/worldResponse/MissionPressureMapSection.tsx

import type { MotherBrainPressureWindow } from "../../lib/api";
import { formatPressureWindow, getThreatFamilyDisplayName, pressureConfidenceLabel } from "./worldResponseUi";

type MissionPressureMapSectionProps = {
  highlightedPressure: MotherBrainPressureWindow[];
};

export function MissionPressureMapSection({ highlightedPressure }: MissionPressureMapSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>Mother Brain pressure map</strong>
      {highlightedPressure.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No pressure windows flagged yet. Once exposure and hostile pressure rise, the precursor map will nominate likely families.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {highlightedPressure.map((window) => (
            <div key={window.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(26,38,60,0.12)" }}>
              <div><strong>{getThreatFamilyDisplayName(window.threatFamily)}</strong> • {pressureConfidenceLabel(window.confidence)} • pressure {window.pressureScore}/100</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Exposure {window.exposureScore}/100 • window {formatPressureWindow(window.earliestWindowAt, window.latestWindowAt)}</div>
              <div style={{ fontSize: 12, opacity: 0.88 }}>{window.summary}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>{window.detail}</div>
              <div style={{ fontSize: 12, opacity: 0.78 }}>Likely lanes: {(window.responseTags ?? []).join("/")}</div>
              {(window.reasons ?? []).length ? (
                <div style={{ display: "grid", gap: 4 }}>
                  {(window.reasons ?? []).map((reason, idx) => (
                    <div key={`${window.id}_${idx}`} style={{ fontSize: 12, opacity: 0.76 }}>• {reason}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
