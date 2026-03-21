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

export type OpeningActionReceipt = {
  id: string;
  title: string;
  detail: string;
  impactSummary?: string;
  outcome: "success" | "warning" | "failure";
  timestamp: string;
};

function dedupeOpeningActionReceipts(receipts: OpeningActionReceipt[]): OpeningActionReceipt[] {
  const seen = new Set<string>();
  const deduped: OpeningActionReceipt[] = [];
  for (const receipt of receipts) {
    const key = `${receipt.title}__${receipt.detail}__${receipt.impactSummary ?? ""}__${receipt.outcome}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(receipt);
    if (deduped.length >= 5) break;
  }
  return deduped;
}


const OPENING_RECEIPTS_STORAGE_PREFIX = "planarwar:opening-action-receipts:v1:";

function getOpeningReceiptsStorageKey(cityId: string): string {
  return `${OPENING_RECEIPTS_STORAGE_PREFIX}${cityId}`;
}

function readStoredOpeningActionReceipts(cityId: string): OpeningActionReceipt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(getOpeningReceiptsStorageKey(cityId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .filter((entry): entry is OpeningActionReceipt => !!entry && typeof entry === "object")
      .map((entry: any) => ({
        id: String(entry.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        title: String(entry.title ?? "Recent action"),
        detail: String(entry.detail ?? "Action applied."),
        impactSummary: typeof entry.impactSummary === "string" ? entry.impactSummary : undefined,
        outcome: entry.outcome === "failure" || entry.outcome === "warning" ? entry.outcome : "success",
        timestamp: String(entry.timestamp ?? new Date().toISOString()),
      }));
    return dedupeOpeningActionReceipts(normalized);
  } catch {
    return [];
  }
}

function writeStoredOpeningActionReceipts(cityId: string, receipts: OpeningActionReceipt[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getOpeningReceiptsStorageKey(cityId), JSON.stringify(dedupeOpeningActionReceipts(receipts)));
  } catch {
    // Ignore storage failures; the live UI state still works.
  }
}

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
  const [openingActionReceipts, setOpeningActionReceipts] = useState<OpeningActionReceipt[]>([]);

  const noticeTimer = useRef<number | null>(null);

  const setFlash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  };

  const refreshMe = async (mode = serviceMode): Promise<MeProfile | null> => {
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
      return data;
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Failed to refresh city state");
      return null;
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

  useEffect(() => {
    const cityId = me?.city?.id;
    if (!cityId) {
      setOpeningActionReceipts([]);
      return;
    }
    setOpeningActionReceipts(readStoredOpeningActionReceipts(cityId));
  }, [me?.city?.id]);

  useEffect(() => {
    const cityId = me?.city?.id;
    if (!cityId) return;
    writeStoredOpeningActionReceipts(cityId, openingActionReceipts);
  }, [me?.city?.id, openingActionReceipts]);

  const dismissOpeningActionReceipt = (receiptId: string) => {
    setOpeningActionReceipts((current) => current.filter((receipt) => receipt.id !== receiptId));
  };

  const clearOpeningActionReceipts = () => {
    setOpeningActionReceipts([]);
  };

  const {
    handleBuildBuilding,
    handleCompleteMission,
    handleCreateCity,
    handleEquipHeroAttachment,
    handleExecuteOpeningOperation,
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
    setOpeningActionReceipts,
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
    handleExecuteOpeningOperation,
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
    openingActionReceipts,
    dismissOpeningActionReceipt,
    clearOpeningActionReceipts,
    refreshMe,
    setCityNameDraft,
    citySetupLane,
    setCitySetupLane,
    worldActionBusyId,
  };
}
