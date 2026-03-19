//web-frontend/components/worldResponse/MissionResponsePanel.tsx

import type { Dispatch, SetStateAction } from "react";
import type {
  ActiveMission,
  CityAlphaScopeLockSummary,
  CityAlphaStatusSummary,
  EconomyCartelResponseState,
  MeProfile,
  MissionBoardResponse,
  MissionDefenseReceipt,
  MissionOffer,
  MissionResponsePosture,
  MotherBrainPressureWindow,
  ThreatWarning,
  WorldConsequenceActionItem,
} from "../../lib/api";
import { ActiveMissionsSection } from "./ActiveMissionsSection";
import { CityAlphaPanels } from "./CityAlphaPanels";
import { MissionBoardDigest } from "./MissionBoardDigest";
import { MissionDefenseReceiptsSection } from "./MissionDefenseReceiptsSection";
import { MissionOffersSection } from "./MissionOffersSection";
import { MissionPressureMapSection } from "./MissionPressureMapSection";
import { MissionWarningWindowsSection } from "./MissionWarningWindowsSection";
import { WorldResponseSection } from "./WorldResponseSection";
import { getThreatFamilyDisplayName } from "./worldResponseUi";

type MissionResponsePanelProps = {
  me: MeProfile;
  missionBoard: MissionBoardResponse | null;
  missionOffers: MissionOffer[];
  activeMissions: ActiveMission[];
  highlightedWarnings: ThreatWarning[];
  highlightedPressure: MotherBrainPressureWindow[];
  highlightedReceipts: MissionDefenseReceipt[];
  cityAlphaStatus: CityAlphaStatusSummary | null;
  cityAlphaScopeLock: CityAlphaScopeLockSummary | null;
  economyCartelResponseState: EconomyCartelResponseState | null;
  disabled: boolean;
  missionHeroSelection: Record<string, string>;
  missionArmySelection: Record<string, string>;
  missionPostureSelection: Record<string, MissionResponsePosture>;
  setMissionHeroSelection: Dispatch<SetStateAction<Record<string, string>>>;
  setMissionArmySelection: Dispatch<SetStateAction<Record<string, string>>>;
  setMissionPostureSelection: Dispatch<SetStateAction<Record<string, MissionResponsePosture>>>;
  handleStartMission: (
    missionId: string,
    heroId?: string,
    armyId?: string,
    responsePosture?: MissionResponsePosture
  ) => void | Promise<void>;
  handleCompleteMission: (instanceId: string) => void | Promise<void>;
  worldConsequences: MeProfile["worldConsequences"] extends infer T ? NonNullable<T> : never;
  worldConsequenceState: MeProfile["worldConsequenceState"];
  worldConsequenceHooks: MeProfile["worldConsequenceHooks"];
  worldConsequenceConsumers: MeProfile["worldConsequenceConsumers"];
  worldConsequenceResponseReceipts: MeProfile["worldConsequenceResponseReceipts"];
  worldConsequenceActions: MeProfile["worldConsequenceActions"];
  worldActionBusyId: string | null;
  onExecuteWorldAction: (action: WorldConsequenceActionItem) => void | Promise<void>;
};

export function MissionResponsePanel({
  me,
  missionBoard,
  missionOffers,
  activeMissions,
  highlightedWarnings,
  highlightedPressure,
  highlightedReceipts,
  cityAlphaStatus,
  cityAlphaScopeLock,
  economyCartelResponseState,
  disabled,
  missionHeroSelection,
  missionArmySelection,
  missionPostureSelection,
  setMissionHeroSelection,
  setMissionArmySelection,
  setMissionPostureSelection,
  handleStartMission,
  handleCompleteMission,
  worldConsequences,
  worldConsequenceState,
  worldConsequenceHooks,
  worldConsequenceConsumers,
  worldConsequenceResponseReceipts,
  worldConsequenceActions,
  worldActionBusyId,
  onExecuteWorldAction,
}: MissionResponsePanelProps) {
  return (
    <div style={{ border: "1px solid #444", borderRadius: 8, padding: 16, display: "grid", gap: 12 }}>
      <h3 style={{ marginTop: 0, marginBottom: 0 }}>Mission Command Board</h3>
      <div style={{ fontSize: 13, opacity: 0.82 }}>Mission offers now consume the city ↔ MUD bridge posture instead of pretending logistics are imaginary.</div>
      {me.cityStress ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>City stress {me.cityStress.stage} • total {me.cityStress.total} • recovery burden {me.cityStress.recoveryBurden}</div>
      ) : null}

      <MissionBoardDigest
        me={me}
        missionOffers={missionOffers}
        activeMissions={activeMissions}
        highlightedWarnings={highlightedWarnings}
        highlightedPressure={highlightedPressure}
        highlightedReceipts={highlightedReceipts}
        economyCartelResponseState={economyCartelResponseState}
      />

      {missionBoard?.bridgeConsumers?.missionBoard ? (
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div><strong>Support lane:</strong> {missionBoard.bridgeConsumers.missionBoard.state} • severity {missionBoard.bridgeConsumers.missionBoard.severity}</div>
          <div style={{ fontSize: 12, opacity: 0.84 }}>{missionBoard.bridgeConsumers.missionBoard.headline}</div>
          <div style={{ fontSize: 12, opacity: 0.74 }}>{missionBoard.bridgeConsumers.missionBoard.detail}</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>Recommended action: {missionBoard.bridgeConsumers.missionBoard.recommendedAction}</div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>Incoming pressure</div>
        <MissionWarningWindowsSection highlightedWarnings={highlightedWarnings} />
        <MissionPressureMapSection highlightedPressure={highlightedPressure} />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>Strategic status</div>
        <CityAlphaPanels
          cityAlphaStatus={cityAlphaStatus}
          cityAlphaScopeLock={cityAlphaScopeLock}
          economyCartelResponseState={economyCartelResponseState}
          highlightedPressureCount={highlightedPressure.length}
          getThreatFamilyDisplayName={getThreatFamilyDisplayName}
        />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>Decision desk</div>
        <MissionOffersSection
          me={me}
          missionOffers={missionOffers}
          disabled={disabled}
          missionHeroSelection={missionHeroSelection}
          missionArmySelection={missionArmySelection}
          missionPostureSelection={missionPostureSelection}
          setMissionHeroSelection={setMissionHeroSelection}
          setMissionArmySelection={setMissionArmySelection}
          setMissionPostureSelection={setMissionPostureSelection}
          handleStartMission={handleStartMission}
        />

        <ActiveMissionsSection
          activeMissions={activeMissions}
          disabled={disabled}
          handleCompleteMission={handleCompleteMission}
        />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>Operational history</div>
        <MissionDefenseReceiptsSection highlightedReceipts={highlightedReceipts} />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>World spillover</div>
        <WorldResponseSection
          worldConsequences={worldConsequences ?? []}
          worldConsequenceState={worldConsequenceState ?? null}
          worldConsequenceHooks={worldConsequenceHooks ?? null}
          worldConsequenceConsumers={worldConsequenceConsumers ?? null}
          worldConsequenceResponseReceipts={worldConsequenceResponseReceipts ?? null}
          worldConsequenceActions={worldConsequenceActions ?? null}
          worldActionBusyId={worldActionBusyId}
          onExecuteWorldAction={onExecuteWorldAction}
        />
      </div>
    </div>
  );
}
