// web-frontend/pages/MePage.tsx

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  type MissionOffer,
  type ArmyType,
  type InfrastructureMode,
  type MeProfile,
  type PublicInfrastructureStatusResponse,
  type PublicServiceQuote,
  type Resources,
  type WorldConsequenceActionItem,
  type WorldConsequenceLedgerEntry,
  type WorldConsequenceRegionState,
} from "../lib/api";

const REGION_META: Record<string, { name: string }> = {
  ancient_elwynn: { name: "Ancient Elwynn" },
  heartland_basin: { name: "Heartland Basin" },
  sunfall_coast: { name: "Sunfall Coast" },
  duskwood_border: { name: "Duskwood Border" },
};

function getRegionDisplayName(regionId: string) {
  const meta = REGION_META[regionId];
  if (meta?.name) return meta.name;
  return regionId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}


function getThreatFamilyDisplayName(family?: string) {
  switch (family) {
    case "bandits":
      return "Bandits";
    case "mercs":
      return "Mercenaries";
    case "desperate_towns":
      return "Desperate towns";
    case "organized_hostile_forces":
      return "Organized hostile forces";
    case "early_planar_strike":
      return "Early planar strike";
    default:
      return "Unclear hostile pressure";
  }
}

function getBuildingUpgradeCost(b: CityBuilding) {
  let baseMaterials = 20;
  let baseWealth = 10;

  switch (b.kind) {
    case "housing":
      baseMaterials = 20;
      baseWealth = 10;
      break;
    case "farmland":
      baseMaterials = 25;
      baseWealth = 15;
      break;
    case "mine":
      baseMaterials = 30;
      baseWealth = 20;
      break;
    case "arcane_spire":
      baseMaterials = 40;
      baseWealth = 30;
      break;
    default:
      break;
  }

  const mult = 1 + b.level * 0.5;

  return {
    materials: Math.round(baseMaterials * mult),
    wealth: Math.round(baseWealth * mult),
  };
}

function getBuildingConstructionCost(kind: CityBuilding["kind"]) {
  switch (kind) {
    case "housing":
      return { materials: 30, wealth: 10 };
    case "farmland":
      return { materials: 20, wealth: 5 };
    case "mine":
      return { materials: 40, wealth: 15 };
    case "arcane_spire":
      return { materials: 50, wealth: 25 };
    default:
      return { materials: 20, wealth: 10 };
  }
}

function cardStyle(extra: CSSProperties = {}): CSSProperties {
  return {
    border: "1px solid #444",
    borderRadius: 8,
    padding: 16,
    display: "grid",
    gap: 10,
    ...extra,
  };
}

function formatLevy(levy: Partial<Resources> | undefined): string {
  if (!levy) return "none";
  const parts = Object.entries(levy)
    .filter(([, amount]) => Number(amount ?? 0) > 0)
    .map(([key, amount]) => `${key} ${amount}`);
  return parts.length ? parts.join(", ") : "none";
}


function formatExportableResources(resources: Partial<Resources> | undefined): string {
  if (!resources) return "none";
  const parts = Object.entries(resources)
    .filter(([, amount]) => Number(amount ?? 0) > 0)
    .map(([key, amount]) => `${key} ${amount}`);
  return parts.length ? parts.join(", ") : "none";
}

function formatServiceLabel(service: string): string {
  return service
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatWarningWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startText = Number.isFinite(start.getTime()) ? start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : startIso;
  const endText = Number.isFinite(end.getTime()) ? end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : endIso;
  return `${startText} → ${endText}`;
}

function warningQualityTone(quality: string): string {
  switch (quality) {
    case "precise": return "Precise";
    case "clear": return "Clear";
    case "usable": return "Usable";
    default: return "Faint";
  }
}

function pressureConfidenceLabel(confidence: string): string {
  switch (confidence) {
    case "urgent": return "Urgent";
    case "credible": return "Credible";
    default: return "Watch";
  }
}


function cityAlphaSeverityLabel(severity: string): string {
  switch (severity) {
    case "critical": return "Critical";
    case "pressed": return "Pressed";
    case "watch": return "Watch";
    default: return "Calm";
  }
}

function cityAlphaSeverityColor(severity: string): string {
  switch (severity) {
    case "critical": return "#ff7a7a";
    case "pressed": return "#ffca6b";
    case "watch": return "#9ad0ff";
    default: return "#9ef7b2";
  }
}

function cityAlphaScopeBucketLabel(bucket: string) {
  switch (bucket) {
    case "already_exists": return "Already exists";
    case "exists_but_weak": return "Exists but weak";
    case "missing": return "Missing";
    case "excluded": return "Excluded";
    default: return bucket;
  }
}

function cityAlphaScopeBucketColor(bucket: string) {
  switch (bucket) {
    case "already_exists": return "#3f8f55";
    case "exists_but_weak": return "#a67c2d";
    case "missing": return "#a64545";
    case "excluded": return "#5d5d88";
    default: return "#555";
  }
}

function formatResponseLaneList(tags: string[] | undefined): string {
  return tags && tags.length ? tags.join("/") : "general coverage";
}

function formatWhenShort(iso?: string): string {
  if (!iso) return "now";
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : iso;
}

function formatPressureWindow(startIso: string, endIso: string): string {
  return formatWarningWindow(startIso, endIso);
}

function formatContractKind(kind: string | undefined): string {
  switch (kind) {
    case "stabilize_district": return "Stabilize district";
    case "repair_works": return "Repair works";
    case "relief_convoys": return "Relief convoys";
    case "counter_rumors": return "Counter rumors";
    default: return "";
  }
}


function formatWorldActionCost(cost: Partial<Resources> | undefined): string {
  const entries = Object.entries(cost ?? {}).filter(([, value]) => Number(value ?? 0) > 0);
  if (entries.length <= 0) return "no direct city cost";
  return entries.map(([key, value]) => `${key} ${value}`).join(" • ");
}

function formatWorldActionCooldown(msRemaining: number | undefined): string {
  const totalSeconds = Math.max(0, Math.ceil(Number(msRemaining ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function worldSeverityColor(severity: string): string {
  switch (severity) {
    case "severe": return "#ff7a7a";
    case "pressure": return "#ffca6b";
    default: return "#9ad0ff";
  }
}

function worldHookTone(state: string): string {
  switch (state) {
    case "surging":
    case "severe":
    case "fracturing":
    case "fracture_risk":
    case "active":
      return "#ff9c9c";
    case "opening":
    case "watch":
    case "strained":
    case "volatile":
    case "destabilizing":
      return "#ffd27a";
    default:
      return "#b7d7ff";
  }
}

function worldRegionScore(region: WorldConsequenceRegionState): number {
  return (region.tradeDisruption ?? 0) + (region.blackMarketHeat ?? 0) + Math.abs(region.factionDrift ?? 0) + Math.max(0, region.netPressure ?? 0);
}

function formatWorldDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function formatWorldConsequenceSource(source: string): string {
  return source
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeUsage(usage: AppliedPublicServiceUsage | null | undefined): string | null {
  if (!usage) return null;
  if (usage.quote.mode === "private_city") {
    return `Private lane used. ${usage.summary.note}`;
  }
  const levyText = formatLevy(usage.quote.levy);
  return `${formatServiceLabel(usage.quote.service)} via NPC public lane • levy ${levyText} • queue +${usage.queueAppliedMinutes}m`;
}

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

  const techOptions = me?.availableTechs ?? [];
  const infraSummary = infraStatus?.summary ?? null;
  const receipts = me?.publicInfrastructure?.receipts ?? [];
  const quoteMap = new Map((infraStatus?.quotes ?? []).map((quote) => [quote.service, quote]));
  const bridgeSummary = bridgeStatus?.summary ?? null;
  const bridgeConsumers = bridgeStatus?.consumers ?? null;
  const missionOffers = missionBoard?.missions ?? [];
  const activeMissions = missionBoard?.activeMissions ?? me?.activeMissions ?? [];
  const threatWarnings = missionBoard?.threatWarnings ?? me?.threatWarnings ?? [];
  const motherBrainPressureMap = missionBoard?.motherBrainPressureMap ?? me?.motherBrainPressureMap ?? [];
  const missionReceipts = me?.missionReceipts ?? [];
  const cityAlphaStatus = me?.cityAlphaStatus ?? null;
  const cityAlphaScopeLock = me?.cityAlphaScopeLock ?? null;
  const highlightedWarnings = [...threatWarnings].sort((a, b) => b.severity - a.severity).slice(0, 3);
  const highlightedPressure = [...motherBrainPressureMap].sort((a, b) => b.pressureScore - a.pressureScore).slice(0, 3);
  const highlightedReceipts = [...missionReceipts].slice(0, 5);
  const worldConsequences = me?.worldConsequences ?? [];
  const worldConsequenceState = me?.worldConsequenceState ?? null;
  const worldConsequenceHooks = me?.worldConsequenceHooks ?? null;
  const worldConsequenceActions = me?.worldConsequenceActions ?? null;
  const worldConsequenceResponseReceipts = me?.worldConsequenceResponseReceipts ?? null;
  const worldConsequenceConsumers = me?.worldConsequenceConsumers ?? null;
  const economyCartelResponseState = me?.economyCartelResponseState ?? null;
  const highlightedWorldLedger = [...worldConsequences].slice(0, 5);
  const highlightedWorldRegions = [...(worldConsequenceState?.regions ?? [])].sort((a, b) => worldRegionScore(b) - worldRegionScore(a)).slice(0, 3);

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

      <div style={cardStyle()}>
        <div>
          <strong>User:</strong> {me.username ?? "(unknown)"} <span style={{ opacity: 0.7 }}>({me.userId ?? "?"})</span>
        </div>
        <div>
          <strong>City:</strong> {city ? `${city.name} (Tier ${city.tier})` : "No city yet"}
        </div>
      </div>

      <div style={cardStyle()}>
        <h3 style={{ marginTop: 0 }}>Resources</h3>
        <div>Food: {me.resources.food}</div>
        <div>Materials: {me.resources.materials}</div>
        <div>Wealth: {me.resources.wealth}</div>
        <div>Mana: {me.resources.mana}</div>
        <div>Knowledge: {me.resources.knowledge}</div>
        <div>Unity: {me.resources.unity}</div>
      </div>

      <div style={cardStyle()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Public Infrastructure</h3>
            <div style={{ opacity: 0.8, fontSize: 13 }}>Choose whether eligible actions use private city lanes or NPC public service lanes.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => setServiceMode("private_city")}
              disabled={disabled}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: serviceMode === "private_city" ? "1px solid #7ad" : "1px solid #777",
                background: "#111",
                color: serviceMode === "private_city" ? "#bfe3ff" : "#eee",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              Private City
            </button>
            <button
              onClick={() => setServiceMode("npc_public")}
              disabled={disabled}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: serviceMode === "npc_public" ? "1px solid #d8a" : "1px solid #777",
                background: "#111",
                color: serviceMode === "npc_public" ? "#ffd3ea" : "#eee",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              NPC Public
            </button>
          </div>
        </div>

        {infraSummary ? (
          <>
            <div>
              <strong>Permit tier:</strong> {infraSummary.permitTier} • <strong>Strain band:</strong> {infraSummary.strainBand} • <strong>Recommended:</strong> {infraSummary.recommendedMode}
            </div>
            <div>
              <strong>Heat:</strong> {infraSummary.serviceHeat} • <strong>Queue pressure:</strong> {infraSummary.queuePressure} • <strong>Stress:</strong> {infraSummary.cityStressStage} ({infraSummary.cityStressTotal})
            </div>
            <div>
              <strong>Novice subsidy remaining:</strong> {infraSummary.subsidyCreditsRemaining}
            </div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>{infraSummary.note}</div>
          </>
        ) : (
          <div style={{ opacity: 0.7 }}>No public infrastructure profile yet.</div>
        )}

        <div style={{ display: "grid", gap: 6 }}>
          <strong>Projected service quotes ({serviceMode})</strong>
          {(infraStatus?.quotes ?? []).length === 0 ? (
            <div style={{ opacity: 0.7 }}>No quote data.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {(infraStatus?.quotes ?? []).map((quote: PublicServiceQuote) => (
                <div key={quote.service} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
                  <div><strong>{formatServiceLabel(quote.service)}</strong></div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    Levy: {formatLevy(quote.levy)} • Queue: +{quote.queueMinutes}m • Strain: {quote.strainScore}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{quote.note}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <strong>Recent public receipts</strong>
          {receipts.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No public service receipts yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {receipts.slice().reverse().map((receipt) => (
                <div key={receipt.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
                  <div><strong>{formatServiceLabel(receipt.service)}</strong> • {receipt.mode} • {new Date(receipt.createdAt).toLocaleString()}</div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    Levy: {formatLevy(receipt.levy)} • Queue: +{receipt.queueMinutes}m • Strain: {receipt.strainScore}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{receipt.note}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>


      <div style={cardStyle()}>
        <h3 style={{ marginTop: 0 }}>City ↔ MUD Economic Bridge</h3>
        {bridgeSummary ? (
          <>
            <div>
              <strong>Band:</strong> {bridgeSummary.bridgeBand} • <strong>Posture:</strong> {bridgeSummary.recommendedPosture} • <strong>Support capacity:</strong> {bridgeSummary.supportCapacity}
            </div>
            <div>
              <strong>Logistics pressure:</strong> {bridgeSummary.logisticsPressure} • <strong>Frontier pressure:</strong> {bridgeSummary.frontierPressure} • <strong>Stability pressure:</strong> {bridgeSummary.stabilityPressure}
            </div>
            <div>
              <strong>Exportable surplus:</strong> {formatExportableResources(bridgeSummary.exportableResources)}
            </div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>{bridgeSummary.note}</div>

            {bridgeConsumers ? (
              <div style={{ display: "grid", gap: 6 }}>
                <strong>Live consumer guidance</strong>
                <div style={{ display: "grid", gap: 6 }}>
                  {[bridgeConsumers.vendorSupply, bridgeConsumers.missionBoard, bridgeConsumers.civicServices].map((consumer) => (
                    <div key={consumer.key} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
                      <div>
                        <strong>{consumer.label}</strong> • state {consumer.state} • severity {consumer.severity}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.84 }}>{consumer.headline}</div>
                      <div style={{ fontSize: 12, opacity: 0.76 }}>{consumer.detail}</div>
                      <div style={{ fontSize: 12, opacity: 0.72 }}>Recommended action: {consumer.recommendedAction}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  <strong>Operational advisories</strong>
                  {bridgeConsumers.advisories.map((advisory, index) => (
                    <div key={`${index}_${advisory}`} style={{ fontSize: 12, opacity: 0.8 }}>• {advisory}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={{ display: "grid", gap: 6 }}>
              <strong>Bridge hooks for future world/MUD consumers</strong>
              <div style={{ display: "grid", gap: 6 }}>
                {bridgeSummary.hooks.map((hook) => (
                  <div key={hook.key} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
                    <div>
                      <strong>{hook.label}</strong> • score {hook.score} • direction {hook.direction}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{hook.detail}</div>
                    <div style={{ fontSize: 12, opacity: 0.72 }}>MUD effect: {hook.mudEffect}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.7 }}>No city-to-world bridge snapshot yet.</div>
        )}
      </div>

      <div style={cardStyle()}>
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

        <div style={{ display: "grid", gap: 6 }}>
          <strong>Warning windows</strong>
          {highlightedWarnings.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No active warning windows. Your city is either quiet or blind.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {highlightedWarnings.map((warning) => (
                <div key={warning.id} style={{ border: "1px solid #654", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(80,40,20,0.12)" }}>
                  <div><strong>{warning.headline}</strong> • severity {warning.severity} • intel {warningQualityTone(warning.intelQuality)}</div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>Threat family: {getThreatFamilyDisplayName(warning.threatFamily)}{warning.targetingPressure != null ? ` • pressure ${warning.targetingPressure}` : ""}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Window: {formatWarningWindow(warning.earliestImpactAt, warning.latestImpactAt)} • {getRegionDisplayName(warning.targetRegionId)}</div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>Likely response lanes: {(warning.responseTags ?? []).join(", ")}</div>
                  {warning.targetingReasons?.length ? (
                    <div style={{ fontSize: 12, opacity: 0.78 }}>Why targeted: {(warning.targetingReasons ?? []).join(" ")}</div>
                  ) : null}
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{warning.detail}</div>
                  <div style={{ fontSize: 12, opacity: 0.86 }}><strong>Recommended action:</strong> {warning.recommendedAction}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <strong>City Alpha command board</strong>
          {cityAlphaStatus ? (
            <div style={{ border: `1px solid ${cityAlphaSeverityColor(cityAlphaStatus.severity)}`, borderRadius: 10, padding: 12, display: "grid", gap: 8, background: "rgba(20,20,28,0.55)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div><strong>{cityAlphaStatus.headline}</strong> • {cityAlphaSeverityLabel(cityAlphaStatus.severity)}</div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>{cityAlphaStatus.detail}</div>
                </div>
                <div style={{ fontSize: 12, opacity: 0.86 }}>
                  Readiness {cityAlphaStatus.readinessScore}/100 • burden {cityAlphaStatus.recoveryBurden}/100
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Warnings</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{cityAlphaStatus.openWarningCount} live • next {formatWhenShort(cityAlphaStatus.nextImpactAt)}</div></div>
                <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Pressure windows</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{cityAlphaStatus.urgentPressureCount} urgent • {highlightedPressure.length} surfaced</div></div>
                <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Response teams</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{cityAlphaStatus.idleHeroCount} idle heroes • {cityAlphaStatus.readyArmyCount} ready armies • avg {cityAlphaStatus.averageArmyReadiness}</div></div>
                <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Receipts</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{cityAlphaStatus.recentReceiptCount} recent • {cityAlphaStatus.activeMissionCount} active missions</div></div>
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <strong style={{ fontSize: 13 }}>Tester focus</strong>
                {(cityAlphaStatus.testerFocus ?? []).map((focus, index) => (
                  <div key={`${index}_${focus}`} style={{ fontSize: 12, opacity: 0.84 }}>• {focus}</div>
                ))}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <strong style={{ fontSize: 13 }}>Top pressure items</strong>
                {(cityAlphaStatus.topItems ?? []).length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>No active pressure items yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    {(cityAlphaStatus.topItems ?? []).map((item) => (
                      <div key={item.id} style={{ border: "1px solid #444", borderRadius: 8, padding: 8, display: "grid", gap: 3 }}>
                        <div><strong>{item.headline}</strong> • {item.kind} • severity {item.severity}</div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>{item.detail}</div>
                        <div style={{ fontSize: 12, opacity: 0.72 }}>
                          {item.threatFamily ? `${getThreatFamilyDisplayName(item.threatFamily)} • ` : ""}
                          lanes {formatResponseLaneList(item.responseTags)}{item.when ? ` • ${formatWhenShort(item.when)}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.72 }}>City Alpha summary will appear once a city profile is loaded.</div>
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <strong>City Alpha scope lock</strong>
          {cityAlphaScopeLock ? (
            <div style={{ border: "1px solid #444", borderRadius: 10, padding: 12, display: "grid", gap: 10, background: "rgba(18,18,24,0.5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div><strong>{cityAlphaScopeLock.headline}</strong></div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>{cityAlphaScopeLock.detail}</div>
                </div>
                <div style={{ fontSize: 12, opacity: 0.86 }}>
                  readiness lock {cityAlphaScopeLock.alphaReadyPercent}% • ambiguity {cityAlphaScopeLock.ambiguityCount}
                </div>
              </div>

              {economyCartelResponseState ? (
                <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(56,36,18,0.16)" }}>
                  <div><strong>{economyCartelResponseState.summary.headline}</strong></div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>phase <strong style={{ color: worldSeverityColor(economyCartelResponseState.summary.responsePhase) }}>{economyCartelResponseState.summary.responsePhase}</strong> • runtime {economyCartelResponseState.summary.shouldNudgeRuntime ? "nudging" : "observe only"}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>black market {economyCartelResponseState.blackMarket.state} / {economyCartelResponseState.blackMarket.posture} • cartel {economyCartelResponseState.cartel.tier} / {economyCartelResponseState.cartel.posture}</div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>{economyCartelResponseState.blackMarket.note}</div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>{economyCartelResponseState.cartel.note}</div>
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Already exists</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{(cityAlphaScopeLock.alreadyExists ?? []).length} locked</div></div>
                <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Exists but weak</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{(cityAlphaScopeLock.existsButWeak ?? []).length} follow-up targets</div></div>
                <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Missing</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{(cityAlphaScopeLock.missing ?? []).length} deferred beyond alpha</div></div>
                <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Frozen exclusions</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{(cityAlphaScopeLock.exclusions ?? []).length} explicitly out</div></div>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {[
                  ["already_exists", cityAlphaScopeLock.alreadyExists],
                  ["exists_but_weak", cityAlphaScopeLock.existsButWeak],
                  ["missing", cityAlphaScopeLock.missing],
                  ["excluded", cityAlphaScopeLock.exclusions],
                ].map(([bucket, items]) => (
                  <div key={String(bucket)} style={{ display: "grid", gap: 6 }}>
                    <strong style={{ fontSize: 13 }}>{cityAlphaScopeBucketLabel(String(bucket))}</strong>
                    {(items as any[]).length === 0 ? (
                      <div style={{ fontSize: 12, opacity: 0.68 }}>No items in this bucket.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 6 }}>
                        {(items as any[]).map((item) => (
                          <div key={item.id} style={{ border: `1px solid ${cityAlphaScopeBucketColor(String(bucket))}`, borderRadius: 8, padding: 8, display: "grid", gap: 3 }}>
                            <div><strong>{item.label}</strong></div>
                            <div style={{ fontSize: 12, opacity: 0.82 }}>{item.detail}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <strong style={{ fontSize: 13 }}>Frozen exclusions</strong>
                {(cityAlphaScopeLock.frozenExclusions ?? []).map((entry) => (
                  <div key={entry} style={{ fontSize: 12, opacity: 0.8 }}>• {entry}</div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.72 }}>Scope lock summary will appear once a city profile is loaded.</div>
          )}
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <strong>Available offers</strong>
          {missionOffers.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No mission offers available right now.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {missionOffers.map((mission: MissionOffer) => (
                <div key={mission.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5 }}>
                  <div><strong>{mission.title}</strong> • {mission.kind} • {mission.difficulty} • {getRegionDisplayName(mission.regionId)}</div>
                  {mission.contractKind ? (
                    <div style={{ fontSize: 12, opacity: 0.86 }}>Recovery contract: {formatContractKind(mission.contractKind)} • burden {mission.contractRecoveryBurdenDelta ?? 0} • trust {mission.contractTrustDelta ?? 0} • pressure {mission.contractPressureDelta ?? 0}</div>
                  ) : null}
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Threat family: {getThreatFamilyDisplayName(mission.threatFamily)}{mission.targetingPressure != null ? ` • pressure ${mission.targetingPressure}` : ""}</div>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>{mission.description}</div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>Recommended power {mission.recommendedPower} • rewards {formatLevy(mission.expectedRewards as Partial<Resources>)}</div>
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
                        onChange={(e) => setMissionPostureSelection((prev) => ({ ...prev, [mission.id]: e.target.value as any }))}
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
                        onChange={(e) => setMissionPostureSelection((prev) => ({ ...prev, [mission.id]: e.target.value as any }))}
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

        <div style={{ display: "grid", gap: 6 }}>
          <strong>Mother Brain pressure map</strong>
          {highlightedPressure.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No pressure windows flagged yet. Once exposure and hostile pressure rise, the precursor map will nominate likely families.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {highlightedPressure.map((window) => (
                <div key={window.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(26,38,60,0.12)" }}>
                  <div><strong>{getThreatFamilyDisplayName(window.threatFamily)}</strong> • {pressureConfidenceLabel(window.confidence)} • pressure {window.pressureScore}/100</div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>Exposure {window.exposureScore}/100 • window {formatPressureWindow(window.earliestWindowAt, window.latestWindowAt)}</div>
                  <div style={{ fontSize: 12, opacity: 0.88 }}>{window.summary}</div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>{window.detail}</div>
                  <div style={{ fontSize: 12, opacity: 0.78 }}>Likely lanes: {(window.responseTags ?? []).join("/")}</div>
                  {(window.reasons ?? []).length ? (
                    <div style={{ display: "grid", gap: 4 }}>
                      {(window.reasons ?? []).map((reason, idx) => (
                        <div key={`${window.id}_${idx}`} style={{ fontSize: 12, opacity: 0.76 }}>• {reason}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <strong>Recent defense receipts</strong>
          {highlightedReceipts.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No defense receipts yet. Once missions resolve, setbacks and posture receipts show up here.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {highlightedReceipts.map((receipt) => (
                <div key={receipt.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(60,20,20,0.08)" }}>
                  <div><strong>{receipt.missionTitle}</strong> • {receipt.outcome} • posture {receipt.posture}</div>
                  <div style={{ fontSize: 12, opacity: 0.82 }}>{receipt.summary}</div>
                  {receipt.setbacks.length ? (
                    <div style={{ display: "grid", gap: 4 }}>
                      {receipt.setbacks.map((setback, idx) => (
                        <div key={`${receipt.id}_${idx}`} style={{ fontSize: 12, opacity: 0.8 }}>
                          • <strong>{setback.summary}</strong> — {setback.detail}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, opacity: 0.76 }}>No major setbacks recorded.</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <strong>World consequence outlook</strong>
          {!worldConsequenceState || !worldConsequenceHooks ? (
            <div style={{ opacity: 0.7 }}>World-facing consequence propagation has not produced a readable outlook yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(45,34,74,0.12)" }}>
                <div><strong>{worldConsequenceHooks.summary.headline}</strong></div>
                <div style={{ fontSize: 12, opacity: 0.82 }}>{worldConsequenceState.summary.note}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12 }}>
                  <div>entries <strong>{worldConsequenceState.summary.totalLedgerEntries}</strong></div>
                  <div>severe <strong style={{ color: worldSeverityColor(worldConsequenceState.summary.severeCount > 0 ? "severe" : "watch") }}>{worldConsequenceState.summary.severeCount}</strong></div>
                  <div>destabilization <strong>{worldConsequenceState.summary.destabilizationScore}</strong></div>
                  <div>hooks <strong style={{ color: worldConsequenceHooks.summary.hasActiveHooks ? "#ffd27a" : "#9ef7b2" }}>{worldConsequenceHooks.summary.hasActiveHooks ? "active" : "quiet"}</strong></div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
                  <div><strong>Economy</strong> <span style={{ color: worldHookTone(worldConsequenceHooks.worldEconomy.riskTier) }}>{worldConsequenceHooks.worldEconomy.riskTier}</span></div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>outlook {worldConsequenceHooks.worldEconomy.outlook}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>trade {worldConsequenceHooks.worldEconomy.tradePressure} • supply {worldConsequenceHooks.worldEconomy.supplyFriction}</div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceHooks.worldEconomy.note}</div>
                </div>
                <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
                  <div><strong>Black market</strong> <span style={{ color: worldHookTone(worldConsequenceHooks.blackMarket.status) }}>{worldConsequenceHooks.blackMarket.status}</span></div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>posture {worldConsequenceHooks.blackMarket.recommendedPosture}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>opportunity {worldConsequenceHooks.blackMarket.opportunityScore} • heat {worldConsequenceHooks.blackMarket.heat}</div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceHooks.blackMarket.note}</div>
                </div>
                <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
                  <div><strong>Cartel</strong> <span style={{ color: worldHookTone(worldConsequenceHooks.cartel.pressureTier) }}>{worldConsequenceHooks.cartel.pressureTier}</span></div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>bias {worldConsequenceHooks.cartel.responseBias}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>attention {worldConsequenceHooks.cartel.attention}</div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceHooks.cartel.note}</div>
                </div>
                <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
                  <div><strong>Factions</strong> <span style={{ color: worldHookTone(worldConsequenceHooks.faction.responseBias) }}>{worldConsequenceHooks.faction.responseBias}</span></div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>stance {worldConsequenceHooks.faction.dominantStance}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>instability {worldConsequenceHooks.faction.instability}</div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceHooks.faction.note}</div>
                </div>
              </div>

              
{worldConsequenceConsumers ? (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontWeight: 700, fontSize: 13 }}>Runtime consumer pressure</div>
    <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(64,44,22,0.14)" }}>
      <div>
        <strong>{worldConsequenceConsumers.summary.headline}</strong>{" "}
        <span style={{ color: worldSeverityColor(worldConsequenceConsumers.summary.pressureTier) }}>
          {worldConsequenceConsumers.summary.pressureTier}
        </span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.82 }}>{worldConsequenceConsumers.summary.note}</div>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        source {worldConsequenceConsumers.summary.sourceRegionId ? getRegionDisplayName(worldConsequenceConsumers.summary.sourceRegionId) : "n/a"} •
        runtime {worldConsequenceConsumers.summary.shouldNudgeRuntime ? "nudging" : "observe only"}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
      <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
        <div><strong>Vendors</strong></div>
        <div style={{ fontSize: 12, opacity: 0.82 }}>stock Δ {worldConsequenceConsumers.vendor.stockMultiplierDelta.toFixed(2)}</div>
        <div style={{ fontSize: 12, opacity: 0.82 }}>price min/max Δ {worldConsequenceConsumers.vendor.priceMinDelta.toFixed(2)} / {worldConsequenceConsumers.vendor.priceMaxDelta.toFixed(2)}</div>
        <div style={{ fontSize: 12, opacity: 0.82 }}>cadence Δ {worldConsequenceConsumers.vendor.cadenceDelta.toFixed(2)}</div>
        <div style={{ fontSize: 12, opacity: 0.76 }}>lane bias {worldConsequenceConsumers.vendor.laneBias}</div>
        <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceConsumers.vendor.note}</div>
      </div>
      <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
        <div><strong>Missions</strong></div>
        <div style={{ fontSize: 12, opacity: 0.82 }}>support {worldConsequenceConsumers.missions.supportBias}</div>
        <div style={{ fontSize: 12, opacity: 0.82 }}>severity boost {worldConsequenceConsumers.missions.severityBoost}</div>
        <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceConsumers.missions.note}</div>
      </div>
      <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4 }}>
        <div><strong>Admin</strong></div>
        <div style={{ fontSize: 12, opacity: 0.82 }}>audit watch {worldConsequenceConsumers.admin.auditWatch ? "on" : "off"}</div>
        <div style={{ fontSize: 12, opacity: 0.82 }}>cartel watch {worldConsequenceConsumers.admin.cartelWatch ? "on" : "off"}</div>
        <div style={{ fontSize: 12, opacity: 0.76 }}>{worldConsequenceConsumers.admin.note}</div>
      </div>
    </div>
  </div>
) : null}

{worldConsequenceResponseReceipts ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Recent world responses</div>
                  <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(32,50,28,0.12)" }}>
                    <div><strong>{worldConsequenceResponseReceipts.totalRuntimeResponses}</strong> bounded response{worldConsequenceResponseReceipts.totalRuntimeResponses === 1 ? "" : "s"} committed</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{worldConsequenceResponseReceipts.note}</div>
                    <div style={{ fontSize: 12, opacity: 0.72 }}>
                      last response {worldConsequenceResponseReceipts.lastResponseAt ? new Date(worldConsequenceResponseReceipts.lastResponseAt).toLocaleString() : "n/a"}
                    </div>
                  </div>
                  {worldConsequenceResponseReceipts.recent.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>No committed response receipts yet.</div>
                  ) : worldConsequenceResponseReceipts.recent.map((receipt) => (
                    <div key={receipt.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4, background: "rgba(24,24,24,0.12)" }}>
                      <div><strong>{receipt.title}</strong> <span style={{ color: worldHookTone(receipt.severity) }}>{receipt.severity}</span></div>
                      <div style={{ fontSize: 12, opacity: 0.82 }}>{receipt.summary}</div>
                      <div style={{ fontSize: 12, opacity: 0.76 }}>
                        region {getRegionDisplayName(receipt.regionId)} • pressure {formatWorldDelta(receipt.metrics.pressureDelta)} • recovery {formatWorldDelta(receipt.metrics.recoveryDelta)} • threat {formatWorldDelta(receipt.metrics.threatDelta)}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.74, color: "#d8c79f" }}>
                        {receipt.spent && Object.keys(receipt.spent).length > 0 ? `spend ${formatWorldActionCost(receipt.spent)}` : "no tracked spend"}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        {receipt.contractKind ? `contract ${receipt.contractKind} • ` : ""}{receipt.outcome ?? "unknown"} • {new Date(receipt.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

{worldConsequenceActions ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>What to do next</div>
                  <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(28,56,48,0.14)" }}>
                    <div><strong>{worldConsequenceActions.recommendedPrimaryAction}</strong></div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{worldConsequenceActions.headline}</div>
                  </div>
                  {worldConsequenceActions.playerActions.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>No player-facing action recommendations yet.</div>
                  ) : worldConsequenceActions.playerActions.map((action: WorldConsequenceActionItem) => {
                    const executable = action.runtime?.executable ?? false;
                    const isBusy = worldActionBusyId === action.id;
                    return (
                      <div key={action.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 8, background: "rgba(36,36,36,0.14)" }}>
                        <div><strong>{action.title}</strong> <span style={{ color: worldHookTone(action.priority) }}>{action.priority}</span></div>
                        <div style={{ fontSize: 12, opacity: 0.82 }}>{action.summary}</div>
                        <div style={{ fontSize: 12, opacity: 0.76 }}>lane {action.lane}{action.sourceRegionId ? ` • region ${getRegionDisplayName(action.sourceRegionId)}` : ""}</div>
                        {action.evidence && action.evidence.length > 0 ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12, opacity: 0.82 }}>
                            {action.evidence.map((entry, idx) => (
                              <span key={`${action.id}_evidence_${idx}`} style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", color: worldHookTone(entry.tone ?? action.priority) }}>
                                {entry.label} {entry.value}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div style={{ display: "grid", gap: 2, fontSize: 12, opacity: 0.8 }}>
                          {action.recommendedMoves.map((move, idx) => (
                            <div key={`${action.id}_${idx}`}>• {move}</div>
                          ))}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.76 }}>
                          runtime cost {formatWorldActionCost(action.runtime?.cost)}
                        </div>
                        {action.runtime?.shortfall && Object.keys(action.runtime.shortfall).length > 0 ? (
                          <div style={{ fontSize: 12, opacity: 0.78, color: "#f3c77a" }}>
                            still needed {formatWorldActionCost(action.runtime.shortfall)}
                          </div>
                        ) : null}
                        {action.runtime?.remainingAfterCost && Object.keys(action.runtime.remainingAfterCost).length > 0 ? (
                          <div style={{ fontSize: 12, opacity: 0.74, color: "#a7d7b5" }}>
                            after spend {formatWorldActionCost(action.runtime.remainingAfterCost)}
                          </div>
                        ) : null}
                        {action.runtime?.affordability === "cooldown_active" ? (
                          <div style={{ fontSize: 12, opacity: 0.78, color: "#9cc8ff" }}>
                            cooling down {formatWorldActionCooldown(action.runtime.cooldownMsRemaining)}{action.runtime.readyAt ? ` • ready ${new Date(action.runtime.readyAt).toLocaleTimeString()}` : ""}
                          </div>
                        ) : null}
                        {action.runtime?.lastCommittedAt ? (
                          <div style={{ fontSize: 12, opacity: 0.74, color: "#b8d6ff" }}>
                            last committed {new Date(action.runtime.lastCommittedAt).toLocaleString()}{typeof action.runtime.successfulCommitCount === "number" ? ` • ${action.runtime.successfulCommitCount} successful run${action.runtime.successfulCommitCount === 1 ? "" : "s"}` : ""}
                          </div>
                        ) : null}
                        {action.runtime?.lastAppliedEffect ? (
                          <div style={{ fontSize: 12, opacity: 0.74, color: "#9fd8c4" }}>
                            last applied pressure {formatWorldDelta(action.runtime.lastAppliedEffect.pressureDelta)} • recovery {formatWorldDelta(action.runtime.lastAppliedEffect.recoveryDelta)} • control {formatWorldDelta(action.runtime.lastAppliedEffect.controlDelta)} • threat {formatWorldDelta(action.runtime.lastAppliedEffect.threatDelta)}
                          </div>
                        ) : null}
                        {action.runtime?.lastSpent && Object.keys(action.runtime.lastSpent).length > 0 ? (
                          <div style={{ fontSize: 12, opacity: 0.72, color: "#d8c79f" }}>
                            last spend {formatWorldActionCost(action.runtime.lastSpent)}
                          </div>
                        ) : null}
                        {action.runtime?.lastReceiptSummary ? (
                          <div style={{ fontSize: 12, opacity: 0.72, color: "#9fd8c4" }}>
                            last result {action.runtime.lastReceiptSummary}
                          </div>
                        ) : null}
                        {action.runtime?.effect ? (
                          <div style={{ fontSize: 12, opacity: 0.78 }}>
                            expected effect pressure {formatWorldDelta(action.runtime.effect.pressureDelta)} • recovery {formatWorldDelta(action.runtime.effect.recoveryDelta)} • trust {formatWorldDelta(action.runtime.effect.trustDelta)} • control {formatWorldDelta(action.runtime.effect.controlDelta)} • threat {formatWorldDelta(action.runtime.effect.threatDelta)}
                          </div>
                        ) : null}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 12, opacity: 0.7 }}>
                            {action.runtime?.effect?.summary ?? action.runtime?.note ?? (executable ? "This lane can now be committed as a bounded runtime response." : "Advisory only — runtime still cannot execute this lane yet.")}
                          </div>
                          <button
                            type="button"
                            disabled={!executable || isBusy}
                            onClick={() => void handleExecuteWorldAction(action)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 6,
                              border: "1px solid #666",
                              background: executable ? "#111" : "#222",
                              color: executable ? "#fff" : "#888",
                              cursor: !executable || isBusy ? "not-allowed" : "pointer",
                              opacity: !executable || isBusy ? 0.65 : 1,
                            }}
                          >
                            {isBusy ? "Executing…" : (action.runtime?.buttonLabel ?? "Advisory only")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Regional hotspots</div>
                {highlightedWorldRegions.length === 0 ? (
                  <div style={{ opacity: 0.7 }}>No propagated regional hotspots yet.</div>
                ) : highlightedWorldRegions.map((region) => (
                  <div key={region.regionId} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4, background: "rgba(70,35,20,0.08)" }}>
                    <div><strong>{getRegionDisplayName(region.regionId)}</strong> <span style={{ opacity: 0.72 }}>({region.regionId})</span> • <span style={{ color: worldSeverityColor(region.dominantSeverity) }}>{region.dominantSeverity}</span></div>
                    <div style={{ fontSize: 12, opacity: 0.82 }}>pressure {formatWorldDelta(region.netPressure)} • recovery {formatWorldDelta(region.netRecoveryLoad)} • control {formatWorldDelta(region.controlDrift)} • threat {formatWorldDelta(region.threatDrift)}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>trade {region.tradeDisruption} • black market heat {region.blackMarketHeat} • faction drift {region.factionDrift}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>World consequence ledger</div>
                {highlightedWorldLedger.length === 0 ? (
                  <div style={{ opacity: 0.7 }}>No exported ledger entries yet.</div>
                ) : highlightedWorldLedger.map((entry: WorldConsequenceLedgerEntry) => (
                  <div key={entry.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 4, background: "rgba(20,40,65,0.10)" }}>
                    <div><strong>{entry.title}</strong> • <span style={{ color: worldSeverityColor(entry.severity) }}>{entry.severity}</span> • {formatWorldConsequenceSource(entry.source)}</div>
                    <div style={{ fontSize: 12, opacity: 0.82 }}>{entry.summary}</div>
                    <div style={{ fontSize: 12, opacity: 0.74 }}>{entry.detail}</div>
                    <div style={{ fontSize: 12, opacity: 0.76 }}>region {getRegionDisplayName(entry.regionId)} • pressure {formatWorldDelta(entry.metrics.pressureDelta)} • recovery {formatWorldDelta(entry.metrics.recoveryDelta)} • control {formatWorldDelta(entry.metrics.controlDelta)} • threat {formatWorldDelta(entry.metrics.threatDelta)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={cardStyle()}>
        <h3 style={{ marginTop: 0 }}>City</h3>

        {!city ? (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ opacity: 0.85, margin: 0 }}>
              No city attached to this profile yet. This account can bootstrap one now instead of staring at a sad 404 goblin.
            </p>
            {me.canCreateCity ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>City name</span>
                  <input
                    value={cityNameDraft}
                    onChange={(e) => setCityNameDraft(e.target.value)}
                    maxLength={24}
                    placeholder={me.suggestedCityName ?? "Founder's Hold"}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid #666",
                      background: "#111",
                      color: "#eee",
                    }}
                  />
                </label>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  3–24 characters. Letters, numbers, spaces, apostrophes, and hyphens only.
                </div>
                <button
                  onClick={handleCreateCity}
                  disabled={disabled || cityNameDraft.trim().length < 3}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid #777",
                    background: "#111",
                    cursor: disabled ? "not-allowed" : "pointer",
                    width: "fit-content",
                    opacity: disabled ? 0.6 : 1,
                  }}
                >
                  Create City
                </button>
              </>
            ) : null}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gap: 4 }}>
              <div><strong>ID:</strong> {city.id}</div>
              <div><strong>Shard:</strong> {city.shardId}</div>
              <div><strong>Region:</strong> {getRegionDisplayName(city.regionId)} <span style={{ opacity: 0.7 }}>({city.regionId})</span></div>
              <div><strong>Tier:</strong> {city.tier}</div>
              <div><strong>Specialization:</strong> {city.specializationId ? `${city.specializationId} (★${city.specializationStars})` : "None"}</div>
              <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
                <span><strong>City name</strong></span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={cityNameDraft}
                    onChange={(e) => setCityNameDraft(e.target.value)}
                    maxLength={24}
                    disabled={!!me.isDemo}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid #666",
                      background: "#111",
                      color: "#eee",
                      minWidth: 220,
                    }}
                  />
                  {!me.isDemo ? (
                    <button
                      onClick={handleRenameCity}
                      disabled={disabled || cityNameDraft.trim().length < 3 || cityNameDraft.trim() === city.name}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #777",
                        background: "#111",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.6 : 1,
                      }}
                    >
                      Rename City
                    </button>
                  ) : null}
                </div>
              </label>

              <div><strong>Slots:</strong> {city.buildingSlotsUsed} / {city.buildingSlotsMax}</div>
              <button
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #777",
                  background: "#111",
                  cursor: disabled ? "not-allowed" : "pointer",
                  width: "fit-content",
                  opacity: disabled ? 0.6 : 1,
                }}
                onClick={() => void handleTierUpCity()}
                disabled={disabled}
              >
                Tier Up City
              </button>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <strong>Stats</strong>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                <li>Population: {city.stats.population}</li>
                <li>Stability: {city.stats.stability}</li>
                <li>Prosperity: {city.stats.prosperity}</li>
                <li>Security: {city.stats.security}</li>
                <li>Infrastructure: {city.stats.infrastructure}</li>
                <li>Arcane: {city.stats.arcaneSaturation}</li>
                <li>Influence: {city.stats.influence}</li>
                <li>Unity: {city.stats.unity}</li>
              </ul>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <strong>Per-tick production</strong>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                <li>Food: {city.production.foodPerTick}</li>
                <li>Materials: {city.production.materialsPerTick}</li>
                <li>Wealth: {city.production.wealthPerTick}</li>
                <li>Mana: {city.production.manaPerTick}</li>
                <li>Knowledge: {city.production.knowledgePerTick}</li>
                <li>Unity: {city.production.unityPerTick}</li>
              </ul>
            </div>

            <div style={{ border: "1px solid #555", borderRadius: 8, padding: 12, display: "grid", gap: 8 }}>
              <strong>Construct building</strong>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Current lane: <strong>{serviceMode}</strong>. Build quote: {formatLevy(quoteMap.get("building_construct")?.levy)} / +{quoteMap.get("building_construct")?.queueMinutes ?? 0}m
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(["housing", "farmland", "mine", "arcane_spire"] as const).map((kind) => {
                  const cost = getBuildingConstructionCost(kind);
                  return (
                    <button
                      key={kind}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #777",
                        background: "#111",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.6 : 1,
                      }}
                      onClick={() => void handleBuildBuilding(kind)}
                      title={`Cost: ${cost.materials} materials, ${cost.wealth} wealth`}
                      disabled={disabled}
                    >
                      Build {kind.replace("_", " ")} (m{cost.materials}/w{cost.wealth})
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <strong>Buildings</strong>
              {city.buildings.length === 0 ? (
                <p style={{ opacity: 0.8 }}>No buildings yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {city.buildings.map((b) => {
                    const cost = getBuildingUpgradeCost(b);
                    return (
                      <div key={b.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <div>
                          <div><strong>{b.name}</strong> ({b.kind})</div>
                          <div style={{ opacity: 0.85 }}>Level: {b.level}</div>
                        </div>
                        <button
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid #777",
                            background: "#111",
                            cursor: disabled ? "not-allowed" : "pointer",
                            opacity: disabled ? 0.6 : 1,
                          }}
                          onClick={() => void handleUpgradeBuilding(b.id)}
                          title={`Cost: ${cost.materials} materials, ${cost.wealth} wealth`}
                          disabled={disabled}
                        >
                          Upgrade (m{cost.materials}/w{cost.wealth})
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <strong>Heroes</strong>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Recruit quote: {formatLevy(quoteMap.get("hero_recruit")?.levy)} / +{quoteMap.get("hero_recruit")?.queueMinutes ?? 0}m
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(["champion", "scout", "tactician", "mage"] as const).map((role) => (
                  <button
                    key={role}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                    disabled={disabled}
                    onClick={() => void handleRecruitHero(role)}
                  >
                    Recruit {role}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {me.heroes.map((hero) => (
                  <div key={hero.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
                    <div><strong>{hero.name}</strong> ({hero.role}) • power {hero.power} • {hero.status}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Response roles: {hero.responseRoles?.join(", ") || "generalist"}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(hero.traits ?? []).map((trait) => (
                        <span key={trait.id} style={{ border: `1px solid ${trait.polarity === "pro" ? "#2a6" : "#844"}`, borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.9 }} title={trait.summary}>
                          {trait.polarity === "pro" ? "+" : "−"} {trait.name}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontSize: 12, opacity: 0.82 }}>Gear:</div>
                      {(hero.attachments?.length ?? 0) === 0 ? (
                        <div style={{ fontSize: 12, opacity: 0.62 }}>No gear equipped.</div>
                      ) : (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {(hero.attachments ?? []).map((attachment) => (
                            <span key={attachment.id} style={{ border: "1px solid #446", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.92 }} title={attachment.summary ?? `${attachment.family} gear`} >
                              {attachment.name} • {attachment.slot} • {(attachment.responseTags ?? []).join("/")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(["valor_charm", "scouting_cloak", "arcane_focus"] as const).map((kind) => (
                        <button
                          key={kind}
                          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                          disabled={disabled}
                          onClick={() => void handleEquipHeroAttachment(hero.id, kind)}
                          title={kind === "valor_charm" ? "Trinket slot • frontline/recovery" : kind === "scouting_cloak" ? "Utility slot • recon/recovery" : "Focus slot • warding/command"}
                        >
                          Equip {kind}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <strong>Workshop</strong>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Craft quote: {formatLevy(quoteMap.get("workshop_craft")?.levy)} / +{quoteMap.get("workshop_craft")?.queueMinutes ?? 0}m
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(["valor_charm", "scouting_cloak", "arcane_focus"] as const).map((kind) => (
                  <button
                    key={kind}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                    disabled={disabled}
                    onClick={() => void handleWorkshopCraft(kind)}
                  >
                    Craft {kind}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {me.workshopJobs.map((job) => (
                  <div key={job.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <div><strong>{job.attachmentKind}</strong></div>
                      <div style={{ opacity: 0.8, fontSize: 13 }}>Finishes: {new Date(job.finishesAt).toLocaleString()} • {job.completed ? "completed" : "in progress"}</div>
                    </div>
                    <button
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                      disabled={disabled || !job.completed}
                      onClick={() => void handleWorkshopCollect(job.id)}
                    >
                      Collect
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <strong>Tech</strong>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Research quote: {formatLevy(quoteMap.get("tech_research")?.levy)} / +{quoteMap.get("tech_research")?.queueMinutes ?? 0}m
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {techOptions.map((t) => (
                  <button
                    key={t.id}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                    disabled={disabled}
                    onClick={() => void handleStartTech(t.id)}
                    title={t.description ?? t.id}
                  >
                    Start: {t.name}
                  </button>
                ))}
                {!techOptions.length ? <span style={{ opacity: 0.7, fontSize: 13 }}>No tech options (yet).</span> : null}
              </div>
              {me.activeResearch ? <div style={{ fontSize: 13, opacity: 0.85 }}>Active research: {me.activeResearch.name} ({me.activeResearch.progress}/{me.activeResearch.cost})</div> : null}
            </div>
          </>
        )}
      </div>

      <div style={cardStyle()}>
        <h3 style={{ marginTop: 0 }}>Policies & Armies</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(Object.keys(me.policies) as Array<keyof MeProfile["policies"]>).map((key) => (
            <button
              key={key}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
              disabled={disabled}
              onClick={() => { const action = handleTogglePolicy(key); if (action) void action; }}
            >
              {key}: {String(me.policies[key])}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["militia", "line", "vanguard"] as const).map((type) => (
            <button
              key={type}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
              disabled={disabled}
              onClick={() => void handleRaiseArmy(type)}
            >
              Raise {type}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {me.armies.map((army) => (
            <div key={army.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div><strong>{army.name}</strong> ({army.type}) • power {army.power} • size {army.size} • {army.status}</div>
                <div style={{ fontSize: 12, opacity: 0.82 }}>Readiness {army.readiness ?? 0}/100 • upkeep {army.upkeep?.wealth ?? 0} wealth + {army.upkeep?.materials ?? 0} materials/tick</div>
                <div style={{ fontSize: 12, opacity: 0.74 }}>Specialties: {(army.specialties ?? []).join(", ") || "general service"}</div>
              </div>
              <button
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                disabled={disabled}
                onClick={() => void handleReinforceArmy(army.id)}
              >
                Reinforce
              </button>
            </div>
          ))}
        </div>
      </div>

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
