//web-frontend/components/worldResponse/WorldResponseHotspotsSection.tsx

import type { WorldConsequenceRegionState } from "../../lib/api";
import { formatWorldDelta, getRegionDisplayName, worldSeverityColor } from "./worldResponseUi";

type WorldResponseHotspotsSectionProps = {
  highlightedWorldRegions: WorldConsequenceRegionState[];
};

export function WorldResponseHotspotsSection({ highlightedWorldRegions }: WorldResponseHotspotsSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>Regional hotspots</div>
      {highlightedWorldRegions.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No propagated regional hotspots yet.</div>
      ) : highlightedWorldRegions.map((region) => (
        <div key={region.regionId} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4, background: "rgba(70,35,20,0.08)" }}>
          <div><strong>{getRegionDisplayName(region.regionId)}</strong> <span style={{ opacity: 0.72 }}>({region.regionId})</span> • <span style={{ color: worldSeverityColor(region.dominantSeverity) }}>{region.dominantSeverity}</span></div>
          <div style={{ fontSize: 12, opacity: 0.82 }}>pressure {formatWorldDelta(region.netPressure)} • recovery {formatWorldDelta(region.netRecoveryLoad)} • control {formatWorldDelta(region.controlDrift)} • threat {formatWorldDelta(region.threatDrift)}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>trade {region.tradeDisruption} • black market heat {region.blackMarketHeat} • faction drift {region.factionDrift}</div>
        </div>
      ))}
    </div>
  );
}
