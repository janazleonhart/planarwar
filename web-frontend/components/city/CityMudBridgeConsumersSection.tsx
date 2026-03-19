//web-frontend/components/city/CityMudBridgeConsumersSection.tsx

import type { CityMudBridgeStatusResponse } from "../../lib/api";

type CityMudBridgeConsumersSectionProps = {
  consumers: NonNullable<CityMudBridgeStatusResponse["consumers"]>;
};

export function CityMudBridgeConsumersSection({ consumers }: CityMudBridgeConsumersSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>Live consumer guidance</strong>
      <div style={{ display: "grid", gap: 6 }}>
        {[consumers.vendorSupply, consumers.missionBoard, consumers.civicServices].map((consumer) => (
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
        {consumers.advisories.map((advisory, index) => (
          <div key={`${index}_${advisory}`} style={{ fontSize: 12, opacity: 0.8 }}>
            • {advisory}
          </div>
        ))}
      </div>
    </div>
  );
}
