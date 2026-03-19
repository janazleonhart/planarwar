//web-frontend/components/worldResponse/WorldResponseActionsSection.tsx

import type { WorldConsequenceActionItem, WorldConsequenceActionsView } from "../../lib/api";
import { formatWorldActionCooldown, formatWorldActionCost, formatWorldDelta, getRegionDisplayName, worldHookTone } from "./worldResponseUi";

type WorldResponseActionsSectionProps = {
  worldConsequenceActions: WorldConsequenceActionsView;
  worldActionBusyId: string | null;
  onExecuteWorldAction: (action: WorldConsequenceActionItem) => void | Promise<void>;
};

function WorldResponseActionCard({
  action,
  isBusy,
  onExecute,
}: {
  action: WorldConsequenceActionItem;
  isBusy: boolean;
  onExecute: (action: WorldConsequenceActionItem) => void | Promise<void>;
}) {
  const executable = action.runtime?.executable ?? false;

  return (
    <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 8, background: "rgba(36,36,36,0.14)" }}>
      <div><strong>{action.title}</strong> <span style={{ color: worldHookTone(action.priority) }}>{action.priority}</span></div>
      <div style={{ fontSize: 12, opacity: 0.82 }}>{action.summary}</div>
      <div style={{ fontSize: 12, opacity: 0.76 }}>lane {action.lane}{action.sourceRegionId ? ` • region ${getRegionDisplayName(action.sourceRegionId)}` : ""}</div>
      {action.evidence && action.evidence.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12, opacity: 0.82 }}>
          {action.evidence.map((entry, idx) => (
            <span key={`${action.id}_evidence_${idx}`} style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", color: worldHookTone(entry.tone ?? action.priority) }}>
              {entry.label} {entry.value}
            </span>
          ))}
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 2, fontSize: 12, opacity: 0.8 }}>
        {action.recommendedMoves.map((move, idx) => (
          <div key={`${action.id}_${idx}`}>• {move}</div>
        ))}
      </div>
      <div style={{ fontSize: 12, opacity: 0.76 }}>
        runtime cost {formatWorldActionCost(action.runtime?.cost)}
      </div>
      {action.runtime?.shortfall && Object.keys(action.runtime.shortfall).length > 0 ? (
        <div style={{ fontSize: 12, opacity: 0.78, color: "#f3c77a" }}>
          still needed {formatWorldActionCost(action.runtime.shortfall)}
        </div>
      ) : null}
      {action.runtime?.remainingAfterCost && Object.keys(action.runtime.remainingAfterCost).length > 0 ? (
        <div style={{ fontSize: 12, opacity: 0.74, color: "#a7d7b5" }}>
          after spend {formatWorldActionCost(action.runtime.remainingAfterCost)}
        </div>
      ) : null}
      {action.runtime?.blockedFollowupActionTitles && action.runtime.blockedFollowupActionTitles.length > 0 ? (
        <div style={{ fontSize: 12, opacity: 0.76, color: "#fca5a5" }}>
          would block follow-up {action.runtime.blockedFollowupActionTitles.join(", ")}
        </div>
      ) : null}
      {action.runtime?.availableFollowupActionTitles && action.runtime.availableFollowupActionTitles.length > 0 ? (
        <div style={{ fontSize: 12, opacity: 0.76, color: "#86efac" }}>
          follow-up still open {action.runtime.availableFollowupActionTitles.join(", ")}
        </div>
      ) : null}
      {action.runtime?.postCommitState ? (
        <div style={{ fontSize: 12, opacity: 0.74, color: "#9fd8c4" }}>
          after commit stage {action.runtime.postCommitState.stage}
          {action.runtime.postCommitState.stageChanged ? ` (from ${action.runtime.postCommitState.currentStage})` : ""}
          {" • "}unity {action.runtime.postCommitState.unity}
          {" • "}threat {action.runtime.postCommitState.threatPressure}
          {" • "}recovery {action.runtime.postCommitState.recoveryBurden}
          {" • "}strain {action.runtime.postCommitState.total}
        </div>
      ) : null}
      {action.runtime?.affordability === "cooldown_active" ? (
        <div style={{ fontSize: 12, opacity: 0.78, color: "#9cc8ff" }}>
          cooling down {formatWorldActionCooldown(action.runtime.cooldownMsRemaining)}{action.runtime.readyAt ? ` • ready ${new Date(action.runtime.readyAt).toLocaleTimeString()}` : ""}
        </div>
      ) : null}
      {action.runtime?.lastCommittedAt ? (
        <div style={{ fontSize: 12, opacity: 0.74, color: "#b8d6ff" }}>
          last committed {new Date(action.runtime.lastCommittedAt).toLocaleString()}{typeof action.runtime.successfulCommitCount === "number" ? ` • ${action.runtime.successfulCommitCount} successful run${action.runtime.successfulCommitCount === 1 ? "" : "s"}` : ""}
        </div>
      ) : null}
      {action.runtime?.lastAppliedEffect ? (
        <div style={{ fontSize: 12, opacity: 0.74, color: "#9fd8c4" }}>
          last applied pressure {formatWorldDelta(action.runtime.lastAppliedEffect.pressureDelta)} • recovery {formatWorldDelta(action.runtime.lastAppliedEffect.recoveryDelta)} • control {formatWorldDelta(action.runtime.lastAppliedEffect.controlDelta)} • threat {formatWorldDelta(action.runtime.lastAppliedEffect.threatDelta)}
        </div>
      ) : null}
      {action.runtime?.lastSpent && Object.keys(action.runtime.lastSpent).length > 0 ? (
        <div style={{ fontSize: 12, opacity: 0.72, color: "#d8c79f" }}>
          last spend {formatWorldActionCost(action.runtime.lastSpent)}
        </div>
      ) : null}
      {action.runtime?.lastReceiptSummary ? (
        <div style={{ fontSize: 12, opacity: 0.72, color: "#9fd8c4" }}>
          last result {action.runtime.lastReceiptSummary}
        </div>
      ) : null}
      {action.runtime?.effect ? (
        <div style={{ fontSize: 12, opacity: 0.78 }}>
          expected effect pressure {formatWorldDelta(action.runtime.effect.pressureDelta)} • recovery {formatWorldDelta(action.runtime.effect.recoveryDelta)} • trust {formatWorldDelta(action.runtime.effect.trustDelta)} • control {formatWorldDelta(action.runtime.effect.controlDelta)} • threat {formatWorldDelta(action.runtime.effect.threatDelta)}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          {action.runtime?.effect?.summary ?? action.runtime?.note ?? (executable ? "This lane can now be committed as a bounded runtime response." : "Advisory only — runtime still cannot execute this lane yet.")}
        </div>
        <button
          type="button"
          disabled={!executable || isBusy}
          onClick={() => void onExecute(action)}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #666",
            background: executable ? "#111" : "#222",
            color: executable ? "#fff" : "#888",
            cursor: !executable || isBusy ? "not-allowed" : "pointer",
            opacity: !executable || isBusy ? 0.65 : 1,
          }}
        >
          {isBusy ? "Executing…" : (action.runtime?.buttonLabel ?? "Advisory only")}
        </button>
      </div>
    </div>
  );
}

export function WorldResponseActionsSection({ worldConsequenceActions, worldActionBusyId, onExecuteWorldAction }: WorldResponseActionsSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>What to do next</div>
      <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(28,56,48,0.14)" }}>
        <div><strong>{worldConsequenceActions.recommendedPrimaryAction}</strong></div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{worldConsequenceActions.headline}</div>
      </div>
      {worldConsequenceActions.playerActions.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No player-facing action recommendations yet.</div>
      ) : worldConsequenceActions.playerActions.map((action) => (
        <div key={action.id}>
          <WorldResponseActionCard
            action={action}
            isBusy={worldActionBusyId === action.id}
            onExecute={onExecuteWorldAction}
          />
        </div>
      ))}
    </div>
  );
}
