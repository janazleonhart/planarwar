//web-frontend/components/worldResponse/WorldResponseLedgerSection.tsx

import type { WorldConsequenceLedgerEntry } from "../../lib/api";
import {
  formatWorldConsequenceSource,
  formatWorldDelta,
  getRegionDisplayName,
  worldSeverityColor,
} from "./worldResponseUi";

type WorldResponseLedgerSectionProps = {
  highlightedWorldLedger: WorldConsequenceLedgerEntry[];
};

export function WorldResponseLedgerSection({ highlightedWorldLedger }: WorldResponseLedgerSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>World consequence ledger</div>
      {highlightedWorldLedger.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No exported ledger entries yet.</div>
      ) : highlightedWorldLedger.map((entry) => (
        <div key={entry.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4, background: "rgba(20,40,65,0.10)" }}>
          <div><strong>{entry.title}</strong> • <span style={{ color: worldSeverityColor(entry.severity) }}>{entry.severity}</span> • {formatWorldConsequenceSource(entry.source)}</div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>{entry.summary}</div>
          <div style={{ fontSize: 12, opacity: 0.74 }}>{entry.detail}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>region {getRegionDisplayName(entry.regionId)} • pressure {formatWorldDelta(entry.metrics.pressureDelta)} • recovery {formatWorldDelta(entry.metrics.recoveryDelta)} • control {formatWorldDelta(entry.metrics.controlDelta)} • threat {formatWorldDelta(entry.metrics.threatDelta)}</div>
        </div>
      ))}
    </div>
  );
}
