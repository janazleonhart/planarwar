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

          {bridgeConsumers ? <CityMudBridgeConsumersSection consumers={bridgeConsumers} /> : null}

          <CityMudBridgeHooksSection hooks={bridgeSummary.hooks} />
        </>
      ) : (
        <div style={{ opacity: 0.7 }}>No city-to-world bridge snapshot yet.</div>
      )}
    </div>
  );
}
