//web-frontend/components/worldResponse/WorldResponseReceiptsSection.tsx

import type { WorldConsequenceResponseReceiptsView } from "../../lib/api";
import { formatWorldActionCost, formatWorldDelta, getRegionDisplayName, worldHookTone } from "./worldResponseUi";

type WorldResponseReceiptsSectionProps = {
  worldConsequenceResponseReceipts: WorldConsequenceResponseReceiptsView;
};

export function WorldResponseReceiptsSection({ worldConsequenceResponseReceipts }: WorldResponseReceiptsSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Recent world responses</div>
      <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(32,50,28,0.12)" }}>
        <div><strong>{worldConsequenceResponseReceipts.totalRuntimeResponses}</strong> bounded response{worldConsequenceResponseReceipts.totalRuntimeResponses === 1 ? "" : "s"} committed</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{worldConsequenceResponseReceipts.note}</div>
        <div style={{ fontSize: 12, opacity: 0.72 }}>
          last response {worldConsequenceResponseReceipts.lastResponseAt ? new Date(worldConsequenceResponseReceipts.lastResponseAt).toLocaleString() : "n/a"}
        </div>
      </div>
      {worldConsequenceResponseReceipts.recent.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No committed response receipts yet.</div>
      ) : worldConsequenceResponseReceipts.recent.map((receipt) => (
        <div key={receipt.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4, background: "rgba(24,24,24,0.12)" }}>
          <div><strong>{receipt.title}</strong> <span style={{ color: worldHookTone(receipt.severity) }}>{receipt.severity}</span></div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>{receipt.summary}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>
            region {getRegionDisplayName(receipt.regionId)} • pressure {formatWorldDelta(receipt.metrics.pressureDelta)} • recovery {formatWorldDelta(receipt.metrics.recoveryDelta)} • threat {formatWorldDelta(receipt.metrics.threatDelta)}
          </div>
          <div style={{ fontSize: 12, opacity: 0.74, color: "#d8c79f" }}>
            {receipt.spent && Object.keys(receipt.spent).length > 0 ? `spend ${formatWorldActionCost(receipt.spent)}` : "no tracked spend"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {receipt.contractKind ? `contract ${receipt.contractKind} • ` : ""}{receipt.outcome ?? "unknown"} • {new Date(receipt.createdAt).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
