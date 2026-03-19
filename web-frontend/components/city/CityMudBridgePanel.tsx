//web-frontend/components/city/CityMudBridgePanel.tsx

import type { CSSProperties } from "react";
import type { CityMudBridgeStatusResponse, Resources } from "../../lib/api";

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
      <h3 style={{ marginTop: 0 }}>City ↔ MUD Economic Bridge</h3>
      {bridgeSummary ? (
        <>
          <div>
            <strong>Band:</strong> {bridgeSummary.bridgeBand} • <strong>Posture:</strong> {bridgeSummary.recommendedPosture} • <strong>Support capacity:</strong> {bridgeSummary.supportCapacity}
          </div>
          <div>
            <strong>Logistics pressure:</strong> {bridgeSummary.logisticsPressure} • <strong>Frontier pressure:</strong> {bridgeSummary.frontierPressure} • <strong>Stability pressure:</strong> {bridgeSummary.stabilityPressure}
          </div>
          <div>
            <strong>Exportable surplus:</strong> {formatExportableResources(bridgeSummary.exportableResources)}
          </div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>{bridgeSummary.note}</div>

          {bridgeConsumers ? (
            <div style={{ display: "grid", gap: 6 }}>
              <strong>Live consumer guidance</strong>
              <div style={{ display: "grid", gap: 6 }}>
                {[bridgeConsumers.vendorSupply, bridgeConsumers.missionBoard, bridgeConsumers.civicServices].map((consumer) => (
                  <div key={consumer.key} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
                    <div>
                      <strong>{consumer.label}</strong> • state {consumer.state} • severity {consumer.severity}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.84 }}>{consumer.headline}</div>
                    <div style={{ fontSize: 12, opacity: 0.76 }}>{consumer.detail}</div>
                    <div style={{ fontSize: 12, opacity: 0.72 }}>Recommended action: {consumer.recommendedAction}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <strong>Operational advisories</strong>
                {bridgeConsumers.advisories.map((advisory, index) => (
                  <div key={`${index}_${advisory}`} style={{ fontSize: 12, opacity: 0.8 }}>• {advisory}</div>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 6 }}>
            <strong>Bridge hooks for future world/MUD consumers</strong>
            <div style={{ display: "grid", gap: 6 }}>
              {bridgeSummary.hooks.map((hook) => (
                <div key={hook.key} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
                  <div>
                    <strong>{hook.label}</strong> • score {hook.score} • direction {hook.direction}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{hook.detail}</div>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>MUD effect: {hook.mudEffect}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{ opacity: 0.7 }}>No city-to-world bridge snapshot yet.</div>
      )}
    </div>
  );
}
