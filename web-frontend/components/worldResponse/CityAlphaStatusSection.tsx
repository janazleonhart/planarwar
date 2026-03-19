//web-frontend/components/worldResponse/CityAlphaStatusSection.tsx

import type { CityAlphaStatusSummary } from "../../lib/api";
import {
  cityAlphaSeverityColor,
  cityAlphaSeverityLabel,
  formatResponseLaneList,
  formatWhenShort,
} from "./worldResponseUi";

type CityAlphaStatusSectionProps = {
  cityAlphaStatus: CityAlphaStatusSummary | null;
  highlightedPressureCount: number;
  getThreatFamilyDisplayName: (family?: string) => string;
};

export function CityAlphaStatusSection({
  cityAlphaStatus,
  highlightedPressureCount,
  getThreatFamilyDisplayName,
}: CityAlphaStatusSectionProps) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <strong>City Alpha command board</strong>
      {cityAlphaStatus ? (
        <div style={{ border: `1px solid ${cityAlphaSeverityColor(cityAlphaStatus.severity)}`, borderRadius: 10, padding: 12, display: "grid", gap: 8, background: "rgba(20,20,28,0.55)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div><strong>{cityAlphaStatus.headline}</strong> • {cityAlphaSeverityLabel(cityAlphaStatus.severity)}</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>{cityAlphaStatus.detail}</div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.86 }}>
              Readiness {cityAlphaStatus.readinessScore}/100 • burden {cityAlphaStatus.recoveryBurden}/100
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Warnings</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{cityAlphaStatus.openWarningCount} live • next {formatWhenShort(cityAlphaStatus.nextImpactAt)}</div></div>
            <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Pressure windows</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{cityAlphaStatus.urgentPressureCount} urgent • {highlightedPressureCount} surfaced</div></div>
            <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Response teams</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{cityAlphaStatus.idleHeroCount} idle heroes • {cityAlphaStatus.readyArmyCount} ready armies • avg {cityAlphaStatus.averageArmyReadiness}</div></div>
            <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Receipts</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{cityAlphaStatus.recentReceiptCount} recent • {cityAlphaStatus.activeMissionCount} active missions</div></div>
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <strong style={{ fontSize: 13 }}>Tester focus</strong>
            {(cityAlphaStatus.testerFocus ?? []).map((focus, index) => (
              <div key={`${index}_${focus}`} style={{ fontSize: 12, opacity: 0.84 }}>• {focus}</div>
            ))}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <strong style={{ fontSize: 13 }}>Top pressure items</strong>
            {(cityAlphaStatus.topItems ?? []).length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.7 }}>No active pressure items yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {(cityAlphaStatus.topItems ?? []).map((item) => (
                  <div key={item.id} style={{ border: "1px solid #444", borderRadius: 8, padding: 8, display: "grid", gap: 3 }}>
                    <div><strong>{item.headline}</strong> • {item.kind} • severity {item.severity}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{item.detail}</div>
                    <div style={{ fontSize: 12, opacity: 0.72 }}>
                      {item.threatFamily ? `${getThreatFamilyDisplayName(item.threatFamily)} • ` : ""}
                      lanes {formatResponseLaneList(item.responseTags)}{item.when ? ` • ${formatWhenShort(item.when)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ opacity: 0.72 }}>City Alpha summary will appear once a city profile is loaded.</div>
      )}
    </div>
  );
}
