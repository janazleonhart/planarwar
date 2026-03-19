//web-frontend/components/worldResponse/WorldResponsePanel.tsx

import type {
  WorldConsequenceActionItem,
  WorldConsequenceActionsView,
  WorldConsequenceConsumersView,
  WorldConsequenceLedgerEntry,
  WorldConsequenceRegionState,
  WorldConsequenceResponseReceiptsView,
} from "../../lib/api";
import { WorldResponseActionsSection } from "./WorldResponseActionsSection";
import { WorldResponseConsumersSection } from "./WorldResponseConsumersSection";
import { WorldResponseHotspotsSection } from "./WorldResponseHotspotsSection";
import { WorldResponseLedgerSection } from "./WorldResponseLedgerSection";
import { WorldResponseReceiptsSection } from "./WorldResponseReceiptsSection";

type WorldResponsePanelProps = {
  worldConsequenceConsumers: WorldConsequenceConsumersView | null;
  worldConsequenceResponseReceipts: WorldConsequenceResponseReceiptsView | null;
  worldConsequenceActions: WorldConsequenceActionsView | null;
  highlightedWorldRegions: WorldConsequenceRegionState[];
  highlightedWorldLedger: WorldConsequenceLedgerEntry[];
  worldActionBusyId: string | null;
  onExecuteWorldAction: (action: WorldConsequenceActionItem) => void | Promise<void>;
};

export function WorldResponsePanel({
  worldConsequenceConsumers,
  worldConsequenceResponseReceipts,
  worldConsequenceActions,
  highlightedWorldRegions,
  highlightedWorldLedger,
  worldActionBusyId,
  onExecuteWorldAction,
}: WorldResponsePanelProps) {
  return (
    <>
      {worldConsequenceConsumers ? (
        <WorldResponseConsumersSection worldConsequenceConsumers={worldConsequenceConsumers} />
      ) : null}

      {worldConsequenceResponseReceipts ? (
        <WorldResponseReceiptsSection worldConsequenceResponseReceipts={worldConsequenceResponseReceipts} />
      ) : null}

      {worldConsequenceActions ? (
        <WorldResponseActionsSection
          worldConsequenceActions={worldConsequenceActions}
          worldActionBusyId={worldActionBusyId}
          onExecuteWorldAction={onExecuteWorldAction}
        />
      ) : null}

      <WorldResponseHotspotsSection highlightedWorldRegions={highlightedWorldRegions} />

      <WorldResponseLedgerSection highlightedWorldLedger={highlightedWorldLedger} />
    </>
  );
}
