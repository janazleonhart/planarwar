//web-frontend/components/worldResponse/WorldResponseSection.tsx

import type {
  WorldConsequenceActionItem,
  WorldConsequenceActionsView,
  WorldConsequenceConsumersView,
  WorldConsequenceHooksView,
  WorldConsequenceLedgerEntry,
  WorldConsequenceResponseReceiptsView,
  WorldConsequenceState,
} from "../../lib/api";
import { worldRegionScore } from "./worldResponseUi";
import { WorldConsequenceOutlookPanel } from "./WorldConsequenceOutlookPanel";
import { WorldResponsePanel } from "./WorldResponsePanel";

type WorldResponseSectionProps = {
  worldConsequences: WorldConsequenceLedgerEntry[];
  worldConsequenceState: WorldConsequenceState | null;
  worldConsequenceHooks: WorldConsequenceHooksView | null;
  worldConsequenceConsumers: WorldConsequenceConsumersView | null;
  worldConsequenceResponseReceipts: WorldConsequenceResponseReceiptsView | null;
  worldConsequenceActions: WorldConsequenceActionsView | null;
  worldActionBusyId: string | null;
  onExecuteWorldAction: (action: WorldConsequenceActionItem) => void | Promise<void>;
};

export function WorldResponseSection({
  worldConsequences,
  worldConsequenceState,
  worldConsequenceHooks,
  worldConsequenceConsumers,
  worldConsequenceResponseReceipts,
  worldConsequenceActions,
  worldActionBusyId,
  onExecuteWorldAction,
}: WorldResponseSectionProps) {
  const highlightedWorldLedger = [...worldConsequences].slice(0, 5);
  const highlightedWorldRegions = [...(worldConsequenceState?.regions ?? [])]
    .sort((a, b) => worldRegionScore(b) - worldRegionScore(a))
    .slice(0, 3);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>World consequence outlook</strong>
      <div style={{ display: "grid", gap: 8 }}>
        <WorldConsequenceOutlookPanel
          worldConsequenceState={worldConsequenceState}
          worldConsequenceHooks={worldConsequenceHooks}
        />

        <WorldResponsePanel
          worldConsequenceConsumers={worldConsequenceConsumers}
          worldConsequenceResponseReceipts={worldConsequenceResponseReceipts}
          worldConsequenceActions={worldConsequenceActions}
          highlightedWorldRegions={highlightedWorldRegions}
          highlightedWorldLedger={highlightedWorldLedger}
          worldActionBusyId={worldActionBusyId}
          onExecuteWorldAction={onExecuteWorldAction}
        />
      </div>
    </div>
  );
}
