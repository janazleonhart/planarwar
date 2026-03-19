//web-frontend/components/worldResponse/WorldResponseConsumersSection.tsx

import type { WorldConsequenceConsumersView } from "../../lib/api";
import { getRegionDisplayName, worldSeverityColor } from "./worldResponseUi";

type WorldResponseConsumersSectionProps = {
  worldConsequenceConsumers: WorldConsequenceConsumersView;
};

export function WorldResponseConsumersSection({ worldConsequenceConsumers }: WorldResponseConsumersSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Runtime consumer pressure</div>
      <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(64,44,22,0.14)" }}>
        <div>
          <strong>{worldConsequenceConsumers.summary.headline}</strong>{" "}
          <span style={{ color: worldSeverityColor(worldConsequenceConsumers.summary.pressureTier) }}>
            {worldConsequenceConsumers.summary.pressureTier}
          </span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.82 }}>{worldConsequenceConsumers.summary.note}</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          source {worldConsequenceConsumers.summary.sourceRegionId ? getRegionDisplayName(worldConsequenceConsumers.summary.sourceRegionId) : "n/a"} •
          runtime {worldConsequenceConsumers.summary.shouldNudgeRuntime ? "nudging" : "observe only"}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div><strong>Vendors</strong></div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>stock Δ {worldConsequenceConsumers.vendor.stockMultiplierDelta.toFixed(2)}</div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>price min/max Δ {worldConsequenceConsumers.vendor.priceMinDelta.toFixed(2)} / {worldConsequenceConsumers.vendor.priceMaxDelta.toFixed(2)}</div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>cadence Δ {worldConsequenceConsumers.vendor.cadenceDelta.toFixed(2)}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>lane bias {worldConsequenceConsumers.vendor.laneBias}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceConsumers.vendor.note}</div>
        </div>
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div><strong>Missions</strong></div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>support {worldConsequenceConsumers.missions.supportBias}</div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>severity boost {worldConsequenceConsumers.missions.severityBoost}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceConsumers.missions.note}</div>
        </div>
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div><strong>Admin</strong></div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>audit watch {worldConsequenceConsumers.admin.auditWatch ? "on" : "off"}</div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>cartel watch {worldConsequenceConsumers.admin.cartelWatch ? "on" : "off"}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceConsumers.admin.note}</div>
        </div>
      </div>
    </div>
  );
}
