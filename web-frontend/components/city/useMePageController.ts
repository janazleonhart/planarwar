//web-frontend/components/city/useMePageController.ts

import { useEffect, useRef, useState } from "react";
import {
  fetchCityMudBridgeStatus,
  fetchMe,
  fetchMissionBoard,
  fetchPublicInfrastructureStatus,
  type CityMudBridgeStatusResponse,
  type InfrastructureMode,
  type MeProfile,
  type MissionBoardResponse,
  type PublicInfrastructureStatusResponse,
} from "../../lib/api";
import { createMePageActions } from "./createMePageActions";

export type MePageNotice = { kind: "ok" | "err"; text: string } | null;

export function useMePageController(serviceMode: InfrastructureMode) {
  const [me, setMe] = useState<MeProfile | null>(null);
  const [infraStatus, setInfraStatus] = useState<PublicInfrastructureStatusResponse | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<CityMudBridgeStatusResponse | null>(null);
  const [missionBoard, setMissionBoard] = useState<MissionBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [cityNameDraft, setCityNameDraft] = useState("");
  const [citySetupLane, setCitySetupLane] = useState<"city" | "black_market">("city");
  const [worldActionBusyId, setWorldActionBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<MePageNotice>(null);

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
      const [data, infra, bridge, missions] = await Promise.all([
        fetchMe(),
        fetchPublicInfrastructureStatus(mode),
        fetchCityMudBridgeStatus(),
        fetchMissionBoard(),
      ]);
      setMe(data);
      setInfraStatus(infra);
      setBridgeStatus(bridge);
      setMissionBoard(missions);
      setCityNameDraft(data.city?.name ?? data.suggestedCityName ?? "");
      setCitySetupLane(data.city?.settlementLane ?? "city");
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
    // intentionally mount-only; serviceMode changes are handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!me) return;
    void refreshMe(serviceMode);
  }, [serviceMode]);

  const {
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
  } = createMePageActions({
    busyAction,
    cityNameDraft,
    citySetupLane,
    me,
    refreshMe,
    serviceMode,
    setBusyAction,
    setError,
    setFlash,
    setWorldActionBusyId,
    worldActionBusyId,
  });

  return {
    bridgeStatus,
    busyAction,
    cityNameDraft,
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
    citySetupLane,
    setCitySetupLane,
    worldActionBusyId,
  };
}
