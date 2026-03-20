//web-frontend/components/city/CityMudBridgePanel.tsx

import type { CSSProperties } from "react";
import type { CityMudBridgeStatusResponse, Resources } from "../../lib/api";
import { CityMudBridgeConsumersSection } from "./CityMudBridgeConsumersSection";
import { CityMudBridgeHooksSection } from "./CityMudBridgeHooksSection";

type CityMudBridgePanelProps = {
  cardStyle: (extra?: CSSProperties) => CSSProperties;
  bridgeStatus: CityMudBridgeStatusResponse | null;
  formatExportableResources: (resources: Partial<Resources> | undefined) => string;
};

export function CityMudBridgePanel({ cardStyle, bridgeStatus, formatExportableResources }: CityMudBridgePanelProps) {
  const bridgeSummary = bridgeStatus?.summary ?? null;
  const bridgeConsumers = bridgeStatus?.consumers ?? null;

  return (
    <div style={cardStyle()}>
      <div style={{ display: "grid", gap: 6 }}>
        <h3 style={{ margin: 0 }}>City ↔ MUD consequence desk</h3>
        <div style={{ fontSize: 13, opacity: 0.78 }}>
          This is the city’s outward pressure read: what the wider world is likely to feel, which desks are already absorbing the strain, and where your current posture is helping or fraying.
        </div>
      </div>

      {bridgeSummary ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 10 }}>
            <div style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: 10, display: "grid", gap: 3 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Bridge band</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{bridgeSummary.bridgeBand}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>Overall outward support condition.</div>
            </div>
            <div style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: 10, display: "grid", gap: 3 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Recommended posture</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{bridgeSummary.recommendedPosture}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>What the bridge thinks the city can honestly sustain.</div>
            </div>
            <div style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: 10, display: "grid", gap: 3 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Support capacity</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{bridgeSummary.supportCapacity}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>How much outward help the city can keep backing.</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginTop: 10 }}>
            <div style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: 8, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Logistics pressure</div>
              <div style={{ fontWeight: 700 }}>{bridgeSummary.logisticsPressure}</div>
            </div>
            <div style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: 8, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Frontier pressure</div>
              <div style={{ fontWeight: 700 }}>{bridgeSummary.frontierPressure}</div>
            </div>
            <div style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: 8, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Stability pressure</div>
              <div style={{ fontWeight: 700 }}>{bridgeSummary.stabilityPressure}</div>
            </div>
            <div style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: 8, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Exportable surplus</div>
              <div style={{ fontWeight: 700 }}>{formatExportableResources(bridgeSummary.exportableResources)}</div>
            </div>
          </div>

          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 10 }}>{bridgeSummary.note}</div>

          {bridgeConsumers ? <CityMudBridgeConsumersSection consumers={bridgeConsumers} /> : null}

          <CityMudBridgeHooksSection hooks={bridgeSummary.hooks} />
        </>
      ) : (
        <div style={{ border: "1px dashed #666", borderRadius: 10, padding: 12, fontSize: 13, opacity: 0.76, marginTop: 10 }}>
          No city-to-world bridge snapshot yet. Once the city has enough live state to export, this desk will stop being blank and start telling you where outside strain is already landing.
        </div>
      )}
    </div>
  );
}
