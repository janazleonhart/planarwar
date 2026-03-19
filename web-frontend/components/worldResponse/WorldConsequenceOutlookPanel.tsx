//web-frontend/components/worldResponse/WorldConsequenceOutlookPanel.tsx

//web-frontend/components/worldResponse/WorldConsequenceOutlookPanel.tsx

import type { WorldConsequenceHooksView, WorldConsequenceState } from "../../lib/api";
import { worldHookTone, worldSeverityColor } from "./worldResponseUi";

type WorldConsequenceOutlookPanelProps = {
  worldConsequenceState: WorldConsequenceState | null;
  worldConsequenceHooks: WorldConsequenceHooksView | null;
};

export function WorldConsequenceOutlookPanel({
  worldConsequenceState,
  worldConsequenceHooks,
}: WorldConsequenceOutlookPanelProps) {
  if (!worldConsequenceState || !worldConsequenceHooks) {
    return <div style={{ opacity: 0.7 }}>World-facing consequence propagation has not produced a readable outlook yet.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(45,34,74,0.12)" }}>
        <div><strong>{worldConsequenceHooks.summary.headline}</strong></div>
        <div style={{ fontSize: 12, opacity: 0.82 }}>{worldConsequenceState.summary.note}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12 }}>
          <div>entries <strong>{worldConsequenceState.summary.totalLedgerEntries}</strong></div>
          <div>severe <strong style={{ color: worldSeverityColor(worldConsequenceState.summary.severeCount > 0 ? "severe" : "watch") }}>{worldConsequenceState.summary.severeCount}</strong></div>
          <div>destabilization <strong>{worldConsequenceState.summary.destabilizationScore}</strong></div>
          <div>hooks <strong style={{ color: worldConsequenceHooks.summary.hasActiveHooks ? "#ffd27a" : "#9ef7b2" }}>{worldConsequenceHooks.summary.hasActiveHooks ? "active" : "quiet"}</strong></div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div><strong>Economy</strong> <span style={{ color: worldHookTone(worldConsequenceHooks.worldEconomy.riskTier) }}>{worldConsequenceHooks.worldEconomy.riskTier}</span></div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>outlook {worldConsequenceHooks.worldEconomy.outlook}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>trade {worldConsequenceHooks.worldEconomy.tradePressure} • supply {worldConsequenceHooks.worldEconomy.supplyFriction}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceHooks.worldEconomy.note}</div>
        </div>
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div><strong>Black market</strong> <span style={{ color: worldHookTone(worldConsequenceHooks.blackMarket.status) }}>{worldConsequenceHooks.blackMarket.status}</span></div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>posture {worldConsequenceHooks.blackMarket.recommendedPosture}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>opportunity {worldConsequenceHooks.blackMarket.opportunityScore} • heat {worldConsequenceHooks.blackMarket.heat}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceHooks.blackMarket.note}</div>
        </div>
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div><strong>Cartel</strong> <span style={{ color: worldHookTone(worldConsequenceHooks.cartel.pressureTier) }}>{worldConsequenceHooks.cartel.pressureTier}</span></div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>bias {worldConsequenceHooks.cartel.responseBias}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>attention {worldConsequenceHooks.cartel.attention}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceHooks.cartel.note}</div>
        </div>
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div><strong>Factions</strong> <span style={{ color: worldHookTone(worldConsequenceHooks.faction.responseBias) }}>{worldConsequenceHooks.faction.responseBias}</span></div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>stance {worldConsequenceHooks.faction.dominantStance}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>instability {worldConsequenceHooks.faction.instability}</div>
          <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceHooks.faction.note}</div>
        </div>
      </div>
    </div>
  );
}
