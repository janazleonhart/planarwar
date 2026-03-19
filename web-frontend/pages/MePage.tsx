// web-frontend/pages/MePage.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { CityCorePanel } from "../components/city/CityCorePanel";
import { CityIdentityCard } from "../components/city/CityIdentityCard";
import { CityResourcesCard } from "../components/city/CityResourcesCard";
import { buildMePageViewModel } from "../components/city/MePageViewModel";
import { CityMudBridgePanel } from "../components/city/CityMudBridgePanel";
import { CityPolicyArmiesPanel } from "../components/city/CityPolicyArmiesPanel";
import { PublicInfrastructurePanel } from "../components/city/PublicInfrastructurePanel";
import { MissionResponsePanel } from "../components/worldResponse/MissionResponsePanel";
import {
  cardStyle,
  formatExportableResources,
  formatLevy,
  formatServiceLabel,
  getBuildingConstructionCost,
  getBuildingUpgradeCost,
  summarizeUsage,
} from "../components/city/CityUiHelpers";
import {
  formatWorldActionCooldown,
  formatWorldActionCost,
  formatWorldDelta,
} from "../components/worldResponse/worldResponseUi";
import {
  api,
  ApiResponseError,
  bootstrapCity,
  completeMission,
  fetchCityMudBridgeStatus,
  fetchMe,
  fetchMissionBoard,
  fetchPublicInfrastructureStatus,
  renameCity,
  executeWorldConsequenceAction,
  startMission,
  startTech,
  type AppliedPublicServiceUsage,
  type CityBuilding,
  type CityMudBridgeStatusResponse,
  type HeroRole,
  type MissionBoardResponse,
  type ArmyType,
  type InfrastructureMode,
  type MeProfile,
  type PublicInfrastructureStatusResponse,
  type PublicServiceQuote,
  type Resources,
  type WorldConsequenceActionItem,
} from "../lib/api";


export function MePage() {
  const [me, setMe] = useState<MeProfile | null>(null);
  const [infraStatus, setInfraStatus] = useState<PublicInfrastructureStatusResponse | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<CityMudBridgeStatusResponse | null>(null);
  const [missionBoard, setMissionBoard] = useState<MissionBoardResponse | null>(null);
  const [serviceMode, setServiceMode] = useState<InfrastructureMode>("private_city");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [cityNameDraft, setCityNameDraft] = useState("");
  const [missionHeroSelection, setMissionHeroSelection] = useState<Record<string, string>>({});
  const [missionArmySelection, setMissionArmySelection] = useState<Record<string, string>>({});
  const [missionPostureSelection, setMissionPostureSelection] = useState<Record<string, "cautious" | "balanced" | "aggressive" | "desperate">>({});
  const [worldActionBusyId, setWorldActionBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const noticeTimer = useRef<number | null>(null);
  const setFlash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  };

  const refreshMe = async (mode = serviceMode) => {
    setLoading(true);
    setError(null);
    try {
      const [data, infra, bridge, missions] = await Promise.all([fetchMe(), fetchPublicInfrastructureStatus(mode), fetchCityMudBridgeStatus(), fetchMissionBoard()]);
      setMe(data);
      setInfraStatus(infra);
      setBridgeStatus(bridge);
      setMissionBoard(missions);
      setCityNameDraft(data.city?.name ?? data.suggestedCityName ?? "");
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Failed to refresh city state");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshMe(serviceMode);
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!me) return;
    void refreshMe(serviceMode);
  }, [serviceMode]);

  const runAction = async <T,>(label: string, fn: () => Promise<T>, onSuccess?: (result: T) => string | null) => {
    if (busyAction) return;
    setBusyAction(label);
    setError(null);
    try {
      const result = await fn();
      await refreshMe(serviceMode);
      const extra = onSuccess?.(result);
      setFlash("ok", extra ? `${label} ✓ — ${extra}` : `${label} ✓`);
    } catch (err: any) {
      console.error(err);
      setFlash("err", err?.message ?? `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleBuildBuilding = (kind: CityBuilding["kind"]) =>
    runAction(
      `Build ${kind}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/buildings/construct", {
          method: "POST",
          body: JSON.stringify({ kind, serviceMode }),
        }),
      (result) => summarizeUsage(result.publicService)
    );

  const handleUpgradeBuilding = (buildingId: string) =>
    runAction(
      "Upgrade building",
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/buildings/upgrade", {
          method: "POST",
          body: JSON.stringify({ buildingId, serviceMode }),
        }),
      (result) => summarizeUsage(result.publicService)
    );

  const handleTierUpCity = () =>
    runAction("Tier up city", async () => {
      await api("/api/city/tier-up", {
        method: "POST",
        body: JSON.stringify({}),
      });
    });

  const handleCreateCity = () =>
    runAction("Create city", async () => {
      await bootstrapCity(cityNameDraft);
    });

  const handleRenameCity = () =>
    runAction("Rename city", async () => {
      await renameCity(cityNameDraft);
    });

  const handleRaiseArmy = (type: ArmyType) =>
    runAction(`Raise ${type}`, async () => {
      await api("/api/armies/raise", {
        method: "POST",
        body: JSON.stringify({ type }),
      });
    });

  const handleReinforceArmy = (armyId: string) =>
    runAction("Reinforce army", async () => {
      await api("/api/armies/reinforce", {
        method: "POST",
        body: JSON.stringify({ armyId }),
      });
    });

  const handleRecruitHero = (role: HeroRole) =>
    runAction(
      `Recruit ${role}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/heroes/recruit", {
          method: "POST",
          body: JSON.stringify({ role, serviceMode }),
        }),
      (result) => summarizeUsage(result.publicService)
    );

  const handleEquipHeroAttachment = (heroId: string, kind: "valor_charm" | "scouting_cloak" | "arcane_focus") =>
    runAction("Equip attachment", async () => {
      await api("/api/heroes/equip_attachment", {
        method: "POST",
        body: JSON.stringify({ heroId, kind }),
      });
    });

  const handleWorkshopCraft = (kind: "valor_charm" | "scouting_cloak" | "arcane_focus") =>
    runAction(
      `Craft ${kind}`,
      () =>
        api<{ publicService?: AppliedPublicServiceUsage }>("/api/workshop/craft", {
          method: "POST",
          body: JSON.stringify({ kind, serviceMode }),
        }),
      (result) => summarizeUsage(result.publicService)
    );

  const handleWorkshopCollect = (jobId: string) =>
    runAction("Collect craft", async () => {
      await api("/api/workshop/collect", {
        method: "POST",
        body: JSON.stringify({ jobId }),
      });
    });

  const handleTogglePolicy = (key: keyof MeProfile["policies"]) => {
    if (!me) return;
    return runAction(`Toggle ${String(key)}`, async () => {
      await api("/api/policies/toggle", {
        method: "POST",
        body: JSON.stringify({ key, value: !me.policies[key] }),
      });
    });
  };

  const handleStartTech = (techId: string) =>
    runAction(
      `Start tech ${techId}`,
      () => startTech(techId, serviceMode),
      (result: any) => summarizeUsage(result?.publicService)
    );

  const handleStartMission = (missionId: string, heroId?: string, armyId?: string, responsePosture?: "cautious" | "balanced" | "aggressive" | "desperate") =>
    runAction(
      "Start mission",
      () => startMission(missionId, heroId, armyId, responsePosture),
      (result) => {
        const support = result?.missionSupport;
        if (!support) return "Mission launched.";
        return `${support.headline} (${support.state})`;
      }
    );

  const handleCompleteMission = (instanceId: string) =>
    runAction(
      "Complete mission",
      () => completeMission(instanceId),
      () => "Mission resolved and city state refreshed."
    );

  const handleExecuteWorldAction = async (action: WorldConsequenceActionItem) => {
    if (worldActionBusyId) return;
    setWorldActionBusyId(action.id);
    setError(null);
    try {
      const result = await executeWorldConsequenceAction(action.id);
      await refreshMe(serviceMode);
      const applied = result?.result?.appliedEffect;
      const appliedSummary = applied
        ? ` pressure ${formatWorldDelta(applied.pressureDelta)} • recovery ${formatWorldDelta(applied.recoveryDelta)} • trust ${formatWorldDelta(applied.trustDelta)} • control ${formatWorldDelta(applied.controlDelta)} • threat ${formatWorldDelta(applied.threatDelta)}`
        : "";
      setFlash("ok", `${result?.result?.message ?? `${action.title} executed.`}${appliedSummary}`);
    } catch (err: any) {
      console.error(err);
      const result = err instanceof ApiResponseError ? err.data?.result : undefined;
      const shortfall = result?.shortfall;
      const shortfallText = shortfall && Object.keys(shortfall).length > 0
        ? ` Still needed ${formatWorldActionCost(shortfall)}.`
        : "";
      const cooldownText = result?.status === "cooldown_active" && result?.cooldownMsRemaining
        ? ` Ready again in ${formatWorldActionCooldown(result.cooldownMsRemaining)}.`
        : result?.status === "cooldown_active" && result?.readyAt
          ? ` Ready again at ${new Date(result.readyAt).toLocaleString()}.`
          : "";
      setFlash("err", `${err?.message ?? `Failed to execute ${action.title}.`}${shortfallText}${cooldownText}`);
    } finally {
      setWorldActionBusyId(null);
    }
  };

  const city = me?.city ?? null;
  const disabled = !!busyAction;

  const banner = useMemo(() => {
    if (!notice) return null;
    const color = notice.kind === "ok" ? "#b8ffb8" : "salmon";
    const border = notice.kind === "ok" ? "#2a6" : "#a33";
    return (
      <div
        style={{
          border: `1px solid ${border}`,
          background: "#111",
          color,
          padding: "10px 12px",
          borderRadius: 8,
          marginBottom: 10,
          fontSize: 13,
        }}
      >
        {notice.text}
      </div>
    );
  }, [notice]);

  const {
    activeMissions,
    bridgeConsumers,
    bridgeSummary,
    cityAlphaScopeLock,
    cityAlphaStatus,
    economyCartelResponseState,
    highlightedPressure,
    highlightedReceipts,
    highlightedWarnings,
    infraSummary,
    missionOffers,
    quoteMap,
    receipts,
    techOptions,
    worldConsequenceActions,
    worldConsequenceConsumers,
    worldConsequenceHooks,
    worldConsequenceResponseReceipts,
    worldConsequenceState,
    worldConsequences,
  } = buildMePageViewModel(me, infraStatus, bridgeStatus, missionBoard);

  if (loading && !me) return <p>Loading /api/me…</p>;

  if (error) {
    return (
      <section style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>CityBuilder /me</h2>
        <p style={{ color: "salmon" }}>{error}</p>
        <button
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #777",
            background: "#111",
            cursor: "pointer",
          }}
          onClick={() => void refreshMe(serviceMode)}
        >
          Retry
        </button>
      </section>
    );
  }

  if (!me) {
    return (
      <section style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>CityBuilder /me</h2>
        <p>No data.</p>
      </section>
    );
  }

  return (
    <section style={{ padding: 16, display: "grid", gap: 16 }}>
      <h2 style={{ margin: 0 }}>CityBuilder /me</h2>

      {banner}

      {busyAction ? <div style={{ fontSize: 13, opacity: 0.8 }}>Working: {busyAction}…</div> : null}

      <CityIdentityCard
        me={me}
        cardStyle={cardStyle}
      />

      <CityResourcesCard
        resources={me.resources}
        cardStyle={cardStyle}
      />

      <PublicInfrastructurePanel
        cardStyle={cardStyle}
        disabled={disabled}
        serviceMode={serviceMode}
        setServiceMode={setServiceMode}
        infraStatus={infraStatus}
        receipts={receipts}
        formatLevy={formatLevy}
        formatServiceLabel={formatServiceLabel}
      />

      <CityMudBridgePanel
        cardStyle={cardStyle}
        bridgeStatus={bridgeStatus}
        formatExportableResources={formatExportableResources}
      />

      <MissionResponsePanel
        me={me}
        missionBoard={missionBoard}
        missionOffers={missionOffers}
        activeMissions={activeMissions}
        highlightedWarnings={highlightedWarnings}
        highlightedPressure={highlightedPressure}
        highlightedReceipts={highlightedReceipts}
        cityAlphaStatus={cityAlphaStatus}
        cityAlphaScopeLock={cityAlphaScopeLock}
        economyCartelResponseState={economyCartelResponseState}
        disabled={disabled}
        missionHeroSelection={missionHeroSelection}
        missionArmySelection={missionArmySelection}
        missionPostureSelection={missionPostureSelection}
        setMissionHeroSelection={setMissionHeroSelection}
        setMissionArmySelection={setMissionArmySelection}
        setMissionPostureSelection={setMissionPostureSelection}
        handleStartMission={handleStartMission}
        handleCompleteMission={handleCompleteMission}
        worldConsequences={worldConsequences}
        worldConsequenceState={worldConsequenceState}
        worldConsequenceHooks={worldConsequenceHooks}
        worldConsequenceConsumers={worldConsequenceConsumers}
        worldConsequenceResponseReceipts={worldConsequenceResponseReceipts}
        worldConsequenceActions={worldConsequenceActions}
        worldActionBusyId={worldActionBusyId}
        onExecuteWorldAction={handleExecuteWorldAction}
      />

      <CityCorePanel
        cardStyle={cardStyle}
        me={me}
        serviceMode={serviceMode}
        cityNameDraft={cityNameDraft}
        setCityNameDraft={setCityNameDraft}
        disabled={disabled}
        techOptions={techOptions}
        quoteMap={quoteMap}
        formatLevy={formatLevy}
        getBuildingConstructionCost={getBuildingConstructionCost}
        getBuildingUpgradeCost={getBuildingUpgradeCost}
        handleCreateCity={handleCreateCity}
        handleRenameCity={handleRenameCity}
        handleTierUpCity={handleTierUpCity}
        handleBuildBuilding={handleBuildBuilding}
        handleUpgradeBuilding={handleUpgradeBuilding}
        handleRecruitHero={handleRecruitHero}
        handleEquipHeroAttachment={handleEquipHeroAttachment}
        handleWorkshopCraft={handleWorkshopCraft}
        handleWorkshopCollect={handleWorkshopCollect}
        handleStartTech={handleStartTech}
      />

      <CityPolicyArmiesPanel
        cardStyle={cardStyle}
        me={me}
        disabled={disabled}
        handleTogglePolicy={handleTogglePolicy}
        handleRaiseArmy={handleRaiseArmy}
        handleReinforceArmy={handleReinforceArmy}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
          onClick={() => void refreshMe(serviceMode)}
        >
          Refresh
        </button>
        <span style={{ opacity: 0.65, fontSize: 12 }}>
          The bureaucracy is now at least polite enough to show you the troll toll before you click the button.
        </span>
      </div>
    </section>
  );
}
