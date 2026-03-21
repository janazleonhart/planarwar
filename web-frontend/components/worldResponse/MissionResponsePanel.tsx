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
import type { OpeningActionReceipt } from "../city/useMePageController";
import { ActiveMissionsSection } from "./ActiveMissionsSection";
import { CityAlphaPanels } from "./CityAlphaPanels";
import { MissionBoardDigest } from "./MissionBoardDigest";
import { MissionDefenseReceiptsSection } from "./MissionDefenseReceiptsSection";
import { MissionOffersSection } from "./MissionOffersSection";
import { MissionPressureMapSection } from "./MissionPressureMapSection";
import { MissionWarningWindowsSection } from "./MissionWarningWindowsSection";
import { WorldResponseSection } from "./WorldResponseSection";
import { getThreatFamilyDisplayName } from "./worldResponseUi";

type UnifiedRecentResult = {
  id: string;
  timestamp: string;
  title: string;
  detail: string;
  impactSummary?: string;
  tone: "success" | "warning" | "failure";
  source: "opening" | "mission" | "world";
};

function normalizeUnifiedTone(value: string | undefined): UnifiedRecentResult["tone"] {
  if (value === "failure") return "failure";
  if (value === "warning" || value === "partial") return "warning";
  return "success";
}


function formatRecentAgeLabel(timestamp: string): string {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (ageMs < 60_000) return "just now";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isStaleRecentResult(timestamp: string, staleAfterMs: number): boolean {
  return Date.now() - new Date(timestamp).getTime() >= staleAfterMs;
}


function getOperationAvailability(operation: SettlementOpeningOperation, disabled: boolean): {
  label: string;
  detail: string;
} {
  if (disabled) {
    return {
      label: "Board busy",
      detail: "Another command is still resolving on the board. Wait for it to finish before issuing this step.",
    };
  }
  if (operation.readiness === "ready_now") {
    return {
      label: "Ready now",
      detail: "This step can be executed immediately.",
    };
  }
  if (operation.readiness === "prepare_soon") {
    return {
      label: "Needs setup",
      detail: operation.whyNow,
    };
  }
  return {
    label: "Blocked",
    detail: operation.whyNow,
  };
}

function getLatestOpeningReceiptByActionKey(receipts: OpeningActionReceipt[]): Map<string, OpeningActionReceipt> {
  const latest = new Map<string, OpeningActionReceipt>();
  for (const receipt of receipts) {
    if (!receipt.actionKey) continue;
    if (!latest.has(receipt.actionKey)) latest.set(receipt.actionKey, receipt);
  }
  return latest;
}

function buildUnifiedRecentResults({
  openingActionReceipts,
  highlightedReceipts,
  worldConsequenceResponseReceipts,
}: Pick<
  MissionResponsePanelProps,
  "openingActionReceipts" | "highlightedReceipts" | "worldConsequenceResponseReceipts"
>): UnifiedRecentResult[] {
  const opening: UnifiedRecentResult[] = openingActionReceipts.map((receipt) => ({
    id: `opening_${receipt.id}`,
    timestamp: receipt.timestamp,
    title: receipt.title,
    detail: receipt.detail,
    impactSummary: receipt.impactSummary,
    tone: normalizeUnifiedTone(receipt.outcome),
    source: "opening",
  }));

  const mission: UnifiedRecentResult[] = highlightedReceipts.map((receipt) => ({
    id: `mission_${receipt.id}`,
    timestamp: receipt.createdAt,
    title: receipt.missionTitle,
    detail: receipt.summary,
    impactSummary: receipt.setbacks?.[0]?.summary,
    tone: normalizeUnifiedTone(receipt.outcome),
    source: "mission",
  }));

  const world: UnifiedRecentResult[] = (worldConsequenceResponseReceipts?.recent ?? []).map((receipt) => ({
    id: `world_${receipt.id}`,
    timestamp: receipt.createdAt,
    title: receipt.title,
    detail: receipt.summary,
    impactSummary:
      [
        receipt.metrics.pressureDelta
          ? `pressure ${receipt.metrics.pressureDelta > 0 ? "+" : ""}${receipt.metrics.pressureDelta}`
          : null,
        receipt.metrics.recoveryDelta
          ? `recovery ${receipt.metrics.recoveryDelta > 0 ? "+" : ""}${receipt.metrics.recoveryDelta}`
          : null,
        receipt.metrics.controlDelta
          ? `control ${receipt.metrics.controlDelta > 0 ? "+" : ""}${receipt.metrics.controlDelta}`
          : null,
        receipt.metrics.threatDelta
          ? `threat ${receipt.metrics.threatDelta > 0 ? "+" : ""}${receipt.metrics.threatDelta}`
          : null,
      ].filter((entry): entry is string => !!entry).join(" • ") || undefined,
    tone: normalizeUnifiedTone(receipt.outcome),
    source: "world",
  }));

  return [...opening, ...mission, ...world]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);
}

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
  openingActionReceipts: OpeningActionReceipt[];
  onDismissOpeningReceipt: (receiptId: string) => void;
  onClearOpeningReceipts: () => void;
};

function BlackMarketStatusCard({
  actions,
}: {
  actions: NonNullable<MissionResponsePanelProps["worldConsequenceActions"]>;
}) {
  const blackMarketActions = actions.playerActions.filter((action) => action.lane === "black_market");
  if (blackMarketActions.length === 0) return null;

  const executableCount = blackMarketActions.filter((action) => action.runtime?.executable).length;
  const regionLabel = blackMarketActions.find((action) => action.sourceRegionId)?.sourceRegionId ?? null;

  return (
    <div
      style={{
        border: "1px solid #6b4d2b",
        borderRadius: 8,
        padding: 10,
        display: "grid",
        gap: 4,
        background: "linear-gradient(180deg, rgba(52,33,22,0.46) 0%, rgba(18,16,14,0.8) 100%)",
      }}
    >
      <div>
        <strong style={{ color: "#f3d29a" }}>Black market window open</strong>
      </div>
      <div style={{ fontSize: 12, opacity: 0.84 }}>
        The shadow-economy path is currently riding on the same decision desk as the city consequence
        system. You can exploit, contain, or bribe patrol pressure from here without going through the
        builder loop.
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
  openingActionReceipts,
  onDismissOpeningReceipt,
  onClearOpeningReceipts,
}: MissionResponsePanelProps) {
  const recentResults = buildUnifiedRecentResults({
    openingActionReceipts,
    highlightedReceipts,
    worldConsequenceResponseReceipts,
  });
  const latestOpeningReceiptByActionKey = getLatestOpeningReceiptByActionKey(openingActionReceipts);

  return (
    <div style={{ border: "1px solid #444", borderRadius: 8, padding: 16, display: "grid", gap: 12 }}>
      <h3 style={{ marginTop: 0, marginBottom: 0 }}>Mission Command Board</h3>
      <div style={{ fontSize: 13, opacity: 0.82 }}>
        Mission offers now consume the city ↔ MUD bridge posture instead of pretending logistics are
        imaginary.
      </div>
      {me.cityStress ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          City stress {me.cityStress.stage} • total {me.cityStress.total} • recovery burden{" "}
          {me.cityStress.recoveryBurden}
        </div>
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

      {recentResults.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
            Latest field results
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {recentResults.map((result, index) => {
              const tone =
                result.tone === "success"
                  ? {
                      border: "1px solid rgba(110,210,170,0.2)",
                      background: "rgba(35,80,62,0.18)",
                      label: "Applied",
                    }
                  : result.tone === "warning"
                    ? {
                        border: "1px solid rgba(210,180,110,0.2)",
                        background: "rgba(90,72,30,0.18)",
                        label: "Watch",
                      }
                    : {
                        border: "1px solid rgba(210,110,110,0.2)",
                        background: "rgba(90,38,38,0.18)",
                        label: "Failed",
                      };
              const sourceLabel =
                result.source === "opening" ? "opening" : result.source === "mission" ? "mission" : "world";
              const isFresh = index === 0 && !isStaleRecentResult(result.timestamp, 180_000);
              const isStale = isStaleRecentResult(result.timestamp, 900_000);
              const ageLabel = formatRecentAgeLabel(result.timestamp);

              return (
                <div
                  key={result.id}
                  style={{
                    border: tone.border,
                    background: tone.background,
                    borderRadius: 8,
                    padding: 10,
                    display: "grid",
                    gap: 4,
                    boxShadow: isFresh ? "0 0 0 1px rgba(255,255,255,0.08) inset" : "none",
                    opacity: isStale ? 0.72 : 1,
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <strong>{result.title}</strong>
                    <span style={{ fontSize: 11, opacity: 0.72, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {tone.label}
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.62, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {sourceLabel}
                    </span>
                    {isFresh ? (
                      <span
                        style={{ fontSize: 11, opacity: 0.82, textTransform: "uppercase", letterSpacing: 0.4 }}
                      >
                        Newest
                      </span>
                    ) : null}
                    <span style={{ fontSize: 11, opacity: 0.6 }}>
                      {new Date(result.timestamp).toLocaleTimeString()} • {ageLabel}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>{result.detail}</div>
                  {result.impactSummary ? (
                    <div style={{ fontSize: 11, opacity: isStale ? 0.58 : 0.72 }}>{result.impactSummary}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {me.city?.settlementOpeningOperations?.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          {openingActionReceipts.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
                  Immediate receipts
                </div>
                <button
                  type="button"
                  onClick={onClearOpeningReceipts}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid #666",
                    background: "#161616",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  Clear receipts
                </button>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {openingActionReceipts.map((receipt, index) => {
                  const isNewest = index === 0 && !isStaleRecentResult(receipt.timestamp, 120_000);
                  const isStale = isStaleRecentResult(receipt.timestamp, 900_000);
                  const ageLabel = formatRecentAgeLabel(receipt.timestamp);
                  const tone =
                    receipt.outcome === "success"
                      ? {
                          border: "1px solid rgba(110,210,170,0.2)",
                          background: "rgba(35,80,62,0.18)",
                          label: "Applied",
                        }
                      : receipt.outcome === "warning"
                        ? {
                            border: "1px solid rgba(210,180,110,0.2)",
                            background: "rgba(90,72,30,0.18)",
                            label: "Watch",
                          }
                        : {
                            border: "1px solid rgba(210,110,110,0.2)",
                            background: "rgba(90,38,38,0.18)",
                            label: "Failed",
                          };

                  return (
                    <div
                      key={receipt.id}
                      style={{
                        border: tone.border,
                        background: tone.background,
                        borderRadius: 8,
                        padding: 10,
                        display: "grid",
                        gap: 4,
                        boxShadow: isNewest ? "0 0 0 1px rgba(255,255,255,0.08) inset" : "none",
                        opacity: isStale ? 0.72 : 1,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                          <strong>{receipt.title}</strong>
                          <span
                            style={{ fontSize: 11, opacity: 0.72, textTransform: "uppercase", letterSpacing: 0.4 }}
                          >
                            {tone.label}
                          </span>
                          {isNewest ? (
                            <span
                              style={{
                                fontSize: 11,
                                opacity: 0.82,
                                textTransform: "uppercase",
                                letterSpacing: 0.4,
                              }}
                            >
                              Newest
                            </span>
                          ) : null}
                          <span style={{ fontSize: 11, opacity: 0.6 }}>
                            {new Date(receipt.timestamp).toLocaleTimeString()} • {ageLabel}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDismissOpeningReceipt(receipt.id)}
                          style={{
                            padding: "2px 6px",
                            borderRadius: 6,
                            border: "1px solid #666",
                            background: "#161616",
                            cursor: "pointer",
                            fontSize: 11,
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.82 }}>{receipt.detail}</div>
                      {receipt.impactSummary ? (
                        <div style={{ fontSize: 11, opacity: isStale ? 0.58 : 0.72 }}>{receipt.impactSummary}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
            Opening strike order
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {me.city.settlementOpeningOperations.map((operation) => {
              const actionable = operation.readiness !== "blocked";
              const availability = getOperationAvailability(operation, disabled);
              const latestReceipt = latestOpeningReceiptByActionKey.get(operation.id);
              const readinessTone =
                operation.readiness === "ready_now"
                  ? {
                      border: "1px solid rgba(110,210,170,0.2)",
                      background: "rgba(35,80,62,0.2)",
                      label: "Ready now",
                    }
                  : operation.readiness === "prepare_soon"
                    ? {
                        border: "1px solid rgba(210,180,110,0.2)",
                        background: "rgba(90,72,30,0.18)",
                        label: "Prepare soon",
                      }
                    : {
                        border: "1px solid rgba(210,110,110,0.2)",
                        background: "rgba(90,38,38,0.18)",
                        label: "Blocked",
                      };

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
                  <div style={{ fontSize: 12, opacity: 0.76 }}>
                    <strong>Why now:</strong> {operation.whyNow}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>
                    <strong>Payoff:</strong> {operation.payoff}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>
                    <strong>Risk:</strong> {operation.risk}
                  </div>
                  {latestReceipt ? (() => {
                    const latestAgeLabel = formatRecentAgeLabel(latestReceipt.timestamp);
                    const latestIsStale = isStaleRecentResult(latestReceipt.timestamp, 900_000);
                    return (
                    <div
                      style={{
                        border: "1px dashed rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        padding: 8,
                        display: "grid",
                        gap: 4,
                        background: "rgba(255,255,255,0.02)",
                        opacity: latestIsStale ? 0.74 : 1,
                      }}
                    >
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.68 }}>
                        Latest result for this step
                      </div>
                      <div style={{ fontSize: 12, opacity: latestIsStale ? 0.72 : 0.84 }}>{latestReceipt.detail}</div>
                      {latestReceipt.impactSummary ? (
                        <div style={{ fontSize: 11, opacity: latestIsStale ? 0.58 : 0.72 }}>{latestReceipt.impactSummary}</div>
                      ) : null}
                      <div style={{ fontSize: 11, opacity: 0.58 }}>
                        {new Date(latestReceipt.timestamp).toLocaleTimeString()} • {latestAgeLabel}
                      </div>
                    </div>
                    );
                  })() : null}
                  <div style={{ display: "grid", gap: 6 }}>
                    <button
                      type="button"
                      title={availability.detail}
                      aria-label={`${operation.ctaLabel} — ${availability.label}`}
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
                    <div style={{ fontSize: 11, opacity: 0.66 }}>
                      <strong>{availability.label}:</strong> {availability.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {missionBoard?.bridgeConsumers?.missionBoard ? (
        <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
          <div>
            <strong>Support lane:</strong> {missionBoard.bridgeConsumers.missionBoard.state} • severity{" "}
            {missionBoard.bridgeConsumers.missionBoard.severity}
          </div>
          <div style={{ fontSize: 12, opacity: 0.84 }}>{missionBoard.bridgeConsumers.missionBoard.headline}</div>
          <div style={{ fontSize: 12, opacity: 0.74 }}>{missionBoard.bridgeConsumers.missionBoard.detail}</div>
          <div style={{ fontSize: 12, opacity: 0.72 }}>
            Recommended action: {missionBoard.bridgeConsumers.missionBoard.recommendedAction}
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
          Incoming pressure
        </div>
        <MissionWarningWindowsSection highlightedWarnings={highlightedWarnings} />
        <MissionPressureMapSection highlightedPressure={highlightedPressure} />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
          Strategic status
        </div>
        <CityAlphaPanels
          cityAlphaStatus={cityAlphaStatus}
          cityAlphaScopeLock={cityAlphaScopeLock}
          economyCartelResponseState={economyCartelResponseState}
          highlightedPressureCount={highlightedPressure.length}
          getThreatFamilyDisplayName={getThreatFamilyDisplayName}
        />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
          Decision desk
        </div>
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
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
          Operational history
        </div>
        <MissionDefenseReceiptsSection highlightedReceipts={highlightedReceipts} />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.72 }}>
          World spillover
        </div>
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