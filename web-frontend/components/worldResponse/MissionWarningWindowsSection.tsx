// web-frontend/components/worldResponse/MissionWarningWindowsSection.tsx

import type { ThreatWarning } from "../../lib/api";
import { formatResponseLaneList, formatWarningWindow, getRegionDisplayName, getThreatFamilyDisplayName, warningQualityTone } from "./worldResponseUi";

type MissionWarningWindowsSectionProps = {
  highlightedWarnings: ThreatWarning[];
};

export function MissionWarningWindowsSection({ highlightedWarnings }: MissionWarningWindowsSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>Warning windows</strong>
      {highlightedWarnings.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No active warning windows. Your city is either quiet or blind.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {highlightedWarnings.map((warning) => (
            <div key={warning.id} style={{ border: "1px solid #654", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(80,40,20,0.12)" }}>
              <div><strong>{warning.headline}</strong> • severity {warning.severity} • intel {warningQualityTone(warning.intelQuality)}</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Threat family: {getThreatFamilyDisplayName(warning.threatFamily)}{warning.targetingPressure != null ? ` • pressure ${warning.targetingPressure}` : ""}</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Window: {formatWarningWindow(warning.earliestImpactAt, warning.latestImpactAt)} • {getRegionDisplayName(warning.targetRegionId)}</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Likely response lanes: {formatResponseLaneList(warning.responseTags)}</div>
              {warning.targetingReasons?.length ? (
                <div style={{ fontSize: 12, opacity: 0.78 }}>Why targeted: {(warning.targetingReasons ?? []).join(" ")}</div>
              ) : null}
              <div style={{ fontSize: 12, opacity: 0.8 }}>{warning.detail}</div>
              <div style={{ fontSize: 12, opacity: 0.86 }}><strong>Recommended action:</strong> {warning.recommendedAction}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
