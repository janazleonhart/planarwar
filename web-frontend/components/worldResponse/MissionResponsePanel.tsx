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
import { CityAlphaPanels } from "./CityAlphaPanels";
import { MissionDefenseReceiptsSection } from "./MissionDefenseReceiptsSection";
import { MissionPressureMapSection } from "./MissionPressureMapSection";
import { MissionWarningWindowsSection } from "./MissionWarningWindowsSection";
import { WorldResponseSection } from "./WorldResponseSection";
import {
  formatContractKind,
  formatWorldActionCost,
  getRegionDisplayName,
  getThreatFamilyDisplayName,
} from "./worldResponseUi";

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
    <div style={{ border: "1px solid #444", borderRadius: 8, padding: 16, display: "grid", gap: 10 }}>
      <h3 style={{ marginTop: 0 }}>Mission Board</h3>
      <div style={{ fontSize: 13, opacity: 0.82 }}>Mission offers now consume the city ↔ MUD bridge posture instead of pretending logistics are imaginary.</div>
      {me.cityStress ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>City stress {me.cityStress.stage} • total {me.cityStress.total} • recovery burden {me.cityStress.recoveryBurden}</div>
      ) : null}

      {missionBoard?.bridgeConsumers?.missionBoard ? (
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div><strong>Support lane:</strong> {missionBoard.bridgeConsumers.missionBoard.state} • severity {missionBoard.bridgeConsumers.missionBoard.severity}</div>
          <div style={{ fontSize: 12, opacity: 0.84 }}>{missionBoard.bridgeConsumers.missionBoard.headline}</div>
          <div style={{ fontSize: 12, opacity: 0.74 }}>{missionBoard.bridgeConsumers.missionBoard.detail}</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>Recommended action: {missionBoard.bridgeConsumers.missionBoard.recommendedAction}</div>
        </div>
      ) : null}

      <MissionWarningWindowsSection highlightedWarnings={highlightedWarnings} />

      <CityAlphaPanels
        cityAlphaStatus={cityAlphaStatus}
        cityAlphaScopeLock={cityAlphaScopeLock}
        economyCartelResponseState={economyCartelResponseState}
        highlightedPressureCount={highlightedPressure.length}
        getThreatFamilyDisplayName={getThreatFamilyDisplayName}
      />

      <div style={{ display: "grid", gap: 6 }}>
        <strong>Available offers</strong>
        {missionOffers.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No mission offers available right now.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {missionOffers.map((mission) => (
              <div key={mission.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5 }}>
                <div><strong>{mission.title}</strong> • {mission.kind} • {mission.difficulty} • {getRegionDisplayName(mission.regionId)}</div>
                {mission.contractKind ? (
                  <div style={{ fontSize: 12, opacity: 0.86 }}>Recovery contract: {formatContractKind(mission.contractKind)} • burden {mission.contractRecoveryBurdenDelta ?? 0} • trust {mission.contractTrustDelta ?? 0} • pressure {mission.contractPressureDelta ?? 0}</div>
                ) : null}
                <div style={{ fontSize: 12, opacity: 0.8 }}>Threat family: {getThreatFamilyDisplayName(mission.threatFamily)}{mission.targetingPressure != null ? ` • pressure ${mission.targetingPressure}` : ""}</div>
                <div style={{ fontSize: 13, opacity: 0.85 }}>{mission.description}</div>
                <div style={{ fontSize: 12, opacity: 0.82 }}>Recommended power {mission.recommendedPower} • rewards {formatWorldActionCost(mission.expectedRewards)}</div>
                <div style={{ fontSize: 12, opacity: 0.82 }}>Risk: {mission.risk.casualtyRisk}{mission.risk.heroInjuryRisk ? ` • hero injury ${mission.risk.heroInjuryRisk}` : ""}</div>
                <div style={{ fontSize: 12, opacity: 0.78 }}>Best response lanes: {mission.responseTags?.join(", ") || "generalist"}</div>
                {mission.targetingReasons?.length ? (
                  <div style={{ fontSize: 12, opacity: 0.76 }}>Why this city: {(mission.targetingReasons ?? []).join(" ")}</div>
                ) : null}
                {mission.supportGuidance ? (
                  <div style={{ fontSize: 12, opacity: 0.78 }}>
                    <strong>Support:</strong> {mission.supportGuidance.state} • {mission.supportGuidance.headline}
                  </div>
                ) : null}
                <div style={{ fontSize: 12, opacity: 0.72 }}>{mission.risk.notes}</div>
                {mission.kind === "hero" ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      value={missionHeroSelection[mission.id] ?? ""}
                      onChange={(e) => setMissionHeroSelection((prev) => ({ ...prev, [mission.id]: e.target.value }))}
                      style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #555", background: "#0b0b0b", color: "#ddd", minWidth: 220 }}
                      disabled={disabled}
                    >
                      <option value="">Auto-pick best hero</option>
                      {me.heroes.filter((hero) => hero.status === "idle").map((hero) => (
                        <option key={hero.id} value={hero.id}>
                          {hero.name} • {(hero.responseRoles ?? []).join("/")} • power {hero.power}
                        </option>
                      ))}
                    </select>
                    <select
                      value={missionPostureSelection[mission.id] ?? "balanced"}
                      onChange={(e) => setMissionPostureSelection((prev) => ({ ...prev, [mission.id]: e.target.value as MissionResponsePosture }))}
                      style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #555", background: "#0b0b0b", color: "#ddd" }}
                      disabled={disabled}
                    >
                      <option value="cautious">Cautious posture</option>
                      <option value="balanced">Balanced posture</option>
                      <option value="aggressive">Aggressive posture</option>
                      <option value="desperate">Desperate posture</option>
                    </select>
                    <button
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                      disabled={disabled}
                      onClick={() => void handleStartMission(mission.id, missionHeroSelection[mission.id] || undefined, undefined, missionPostureSelection[mission.id] ?? "balanced")}
                    >
                      Start mission
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      value={missionArmySelection[mission.id] ?? ""}
                      onChange={(e) => setMissionArmySelection((prev) => ({ ...prev, [mission.id]: e.target.value }))}
                      style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #555", background: "#0b0b0b", color: "#ddd", minWidth: 260 }}
                      disabled={disabled}
                    >
                      <option value="">Auto-pick best army</option>
                      {me.armies.filter((army) => army.status === "idle").map((army) => (
                        <option key={army.id} value={army.id}>
                          {army.name} • {(army.specialties ?? []).join("/") || "general service"} • readiness {army.readiness ?? 0} • power {army.power}
                        </option>
                      ))}
                    </select>
                    <select
                      value={missionPostureSelection[mission.id] ?? "balanced"}
                      onChange={(e) => setMissionPostureSelection((prev) => ({ ...prev, [mission.id]: e.target.value as MissionResponsePosture }))}
                      style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #555", background: "#0b0b0b", color: "#ddd" }}
                      disabled={disabled}
                    >
                      <option value="cautious">Cautious posture</option>
                      <option value="balanced">Balanced posture</option>
                      <option value="aggressive">Aggressive posture</option>
                      <option value="desperate">Desperate posture</option>
                    </select>
                    <button
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                      disabled={disabled}
                      onClick={() => void handleStartMission(mission.id, undefined, missionArmySelection[mission.id] || undefined, missionPostureSelection[mission.id] ?? "balanced")}
                    >
                      Start mission
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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

      <MissionPressureMapSection highlightedPressure={highlightedPressure} />

      <MissionDefenseReceiptsSection highlightedReceipts={highlightedReceipts} />

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
  );
}
