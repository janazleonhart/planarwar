//web-frontend/components/worldResponse/ActiveMissionsSection.tsx

import type { ActiveMission } from "../../lib/api";
import { formatContractKind } from "./worldResponseUi";

type ActiveMissionsSectionProps = {
  activeMissions: ActiveMission[];
  disabled: boolean;
  handleCompleteMission: (instanceId: string) => void | Promise<void>;
};

export function ActiveMissionsSection({
  activeMissions,
  disabled,
  handleCompleteMission,
}: ActiveMissionsSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>Active missions</strong>
      {activeMissions.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No active missions.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {activeMissions.map((active) => (
            <div key={active.instanceId} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5 }}>
              <div><strong>{active.mission.title}</strong> • {active.mission.kind} • posture {active.responsePosture} • finishes {new Date(active.finishesAt).toLocaleString()}</div>
              {active.mission.contractKind ? (
                <div style={{ fontSize: 12, opacity: 0.8 }}>Recovery contract: {formatContractKind(active.mission.contractKind)}</div>
              ) : null}
              <div style={{ fontSize: 12, opacity: 0.78 }}>{active.mission.supportGuidance?.headline ?? active.mission.risk.notes ?? "Mission in progress."}</div>
              <div>
                <button
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                  disabled={disabled}
                  onClick={() => void handleCompleteMission(active.instanceId)}
                >
                  Complete mission
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
