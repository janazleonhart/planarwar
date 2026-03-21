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
  SettlementOpeningOperation,
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
  handleExecuteOpeningOperation: (operation: SettlementOpeningOperation) => void | Promise<void>;
  worldConsequences: MeProfile["worldConsequences"] extends infer T ? NonNullable<T> : never;
  worldConsequenceState: MeProfile["worldConsequenceState"];
  worldConsequenceHooks: MeProfile["worldConsequenceHooks"];
  worldConsequenceConsumers: MeProfile["worldConsequenceConsumers"];
  worldConsequenceResponseReceipts: MeProfile["worldConsequenceResponseReceipts"];
  worldConsequenceActions: MeProfile["worldConsequenceActions"];
  worldActionBusyId: string | null;
  onExecuteWorldAction: (action: WorldConsequenceActionItem) => void | Promise<void>;
};

function BlackMarketStatusCard({ actions }: { actions: NonNullable<MissionResponsePanelProps["worldConsequenceActions"]> }) {
  const blackMarketActions = actions.playerActions.filter((action) => action.lane === "black_market");
  if (blackMarketActions.length === 0) return null;

  const executableCount = blackMarketActions.filter((action) => action.runtime?.executable).length;
  const regionLabel = blackMarketActions.find((action) => action.sourceRegionId)?.sourceRegionId ?? null;

  return (
    <div style={{ border: "1px solid #6b4d2b", borderRadius: 8, padding: 10, display: "grid", gap: 4, background: "linear-gradient(180deg, rgba(52,33,22,0.46) 0%, rgba(18,16,14,0.8) 100%)" }}>
      <div><strong style={{ color: "#f3d29a" }}>Black market window open</strong></div>
      <div style={{ fontSize: 12, opacity: 0.84 }}>
        The shadow-economy path is currently riding on the same decision desk as the city consequence system. You can exploit, contain, or bribe patrol pressure from here without going through the builder loop.
      </div>
      <div style={{ fontSize: 12, opacity: 0.76 }}>
        actions {blackMarketActions.length} • executable now {executableCount}
        {regionLabel ? ` • hotspot ${regionLabel}` : ""}
      </div>
    </div>
  );
}

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
  handleExecuteOpeningOperation,
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

      {me.city?.settlementOpeningOperations?.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>Opening strike order</div>
          <div style={{ display: "grid", gap: 10 }}>
            {me.city.settlementOpeningOperations.map((operation) => {
              const actionable = operation.readiness !== "blocked";
              const readinessTone = operation.readiness === "ready_now"
                ? { border: "1px solid rgba(110,210,170,0.2)", background: "rgba(35,80,62,0.2)", label: "Ready now" }
                : operation.readiness === "prepare_soon"
                  ? { border: "1px solid rgba(210,180,110,0.2)", background: "rgba(90,72,30,0.18)", label: "Prepare soon" }
                  : { border: "1px solid rgba(210,110,110,0.2)", background: "rgba(90,38,38,0.18)", label: "Blocked" };
              return (
                <div
                  key={operation.id}
                  style={{
                    border: readinessTone.border,
                    background: readinessTone.background,
                    borderRadius: 10,
                    padding: 12,
                    display: "grid",
                    gap: 5,
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <strong>{operation.title}</strong>
                    <span style={{ fontSize: 11, opacity: 0.74, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {readinessTone.label} · {operation.lane}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.84 }}>{operation.summary}</div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}><strong>Why now:</strong> {operation.whyNow}</div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}><strong>Payoff:</strong> {operation.payoff}</div>
                  <div style={{ fontSize: 12, opacity: 0.72 }}><strong>Risk:</strong> {operation.risk}</div>
                  <div>
                    <button
                      type="button"
                      disabled={disabled || !actionable}
                      onClick={() => void handleExecuteOpeningOperation(operation)}
                      style={{
                        padding: "7px 10px",
                        borderRadius: 8,
                        border: "1px solid #777",
                        background: disabled || !actionable ? "#222" : "#111",
                        color: disabled || !actionable ? "#888" : "inherit",
                        cursor: disabled || !actionable ? "not-allowed" : "pointer",
                      }}
                    >
                      {operation.ctaLabel}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

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
        {worldConsequenceActions ? <BlackMarketStatusCard actions={worldConsequenceActions} /> : null}
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
