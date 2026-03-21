// web-frontend/pages/MePage.tsx

import { useMemo, useState } from "react";
import { CityCorePanel } from "../components/city/CityCorePanel";
import { CityIdentityCard } from "../components/city/CityIdentityCard";
import { CityResourcesCard } from "../components/city/CityResourcesCard";
import { buildMePageViewModel } from "../components/city/MePageViewModel";
import { CityMudBridgePanel } from "../components/city/CityMudBridgePanel";
import { CityPolicyArmiesPanel } from "../components/city/CityPolicyArmiesPanel";
import { PublicInfrastructurePanel } from "../components/city/PublicInfrastructurePanel";
import { useMePageController } from "../components/city/useMePageController";
import { MissionResponsePanel } from "../components/worldResponse/MissionResponsePanel";
import {
  cardStyle,
  formatExportableResources,
  formatLevy,
  formatServiceLabel,
  getBuildingConstructionCost,
  getBuildingUpgradeCost,
} from "../components/city/CityUiHelpers";
import {
  type InfrastructureMode,
} from "../lib/api";

export function MePage() {
  const [serviceMode, setServiceMode] = useState<InfrastructureMode>("private_city");
  const [missionHeroSelection, setMissionHeroSelection] = useState<Record<string, string>>({});
  const [missionArmySelection, setMissionArmySelection] = useState<Record<string, string>>({});
  const [missionPostureSelection, setMissionPostureSelection] = useState<Record<string, "cautious" | "balanced" | "aggressive" | "desperate">>({});

  const {
    bridgeStatus,
    busyAction,
    cityNameDraft,
    citySetupLane,
    error,
    handleBuildBuilding,
    handleCompleteMission,
    handleCreateCity,
    handleEquipHeroAttachment,
    handleExecuteWorldAction,
    handleRaiseArmy,
    handleRecruitHero,
    handleReinforceArmy,
    handleRenameCity,
    handleStartMission,
    handleStartTech,
    handleTierUpCity,
    handleTogglePolicy,
    handleUpgradeBuilding,
    handleWorkshopCollect,
    handleWorkshopCraft,
    infraStatus,
    loading,
    me,
    missionBoard,
    notice,
    refreshMe,
    setCityNameDraft,
    setCitySetupLane,
    worldActionBusyId,
  } = useMePageController(serviceMode);

  const city = me?.city ?? null;
  const disabled = !!busyAction;
  const laneTone = city?.settlementLane === "black_market" || (!city && citySetupLane === "black_market")
    ? {
        border: "1px solid #7a3d3d",
        background: "rgba(80,24,32,0.18)",
        color: "#f4d8d8",
      }
    : {
        border: "1px solid #355d45",
        background: "rgba(25,60,42,0.16)",
        color: "#d9f0df",
      };
  const laneHeading = city
    ? `${city.settlementLaneProfile.label} · ${city.settlementLaneProfile.posture}`
    : citySetupLane === "black_market"
      ? "Black Market · pending founding lane"
      : "City · pending founding lane";
  const laneHint = city
    ? city.settlementLaneProfile.responseFocus.recommendedOpening
    : citySetupLane === "black_market"
      ? "Shadow-first founding path selected"
      : "Civic-first founding path selected";

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
    highlightedPressure,
    highlightedReceipts,
    highlightedWarnings,
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
    cityAlphaScopeLock,
    cityAlphaStatus,
    economyCartelResponseState,
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>CityBuilder /me</h2>
        <span
          style={{
            ...laneTone,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {laneHeading}
        </span>
        <span style={{ opacity: 0.68, fontSize: 12 }}>{laneHint}</span>
      </div>

      {banner}

      {busyAction ? <div style={{ fontSize: 13, opacity: 0.8 }}>Working: {busyAction}…</div> : null}

      <CityIdentityCard
        me={me}
        cardStyle={cardStyle}
      />

      <CityResourcesCard
        resources={me.resources}
        city={me.city}
        cityStress={me.cityStress}
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
        citySetupLane={citySetupLane}
        setCitySetupLane={setCitySetupLane}
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
