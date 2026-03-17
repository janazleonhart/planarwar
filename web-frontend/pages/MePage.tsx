// web-frontend/pages/MePage.tsx

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  api,
  bootstrapCity,
  fetchCityMudBridgeStatus,
  fetchMe,
  fetchPublicInfrastructureStatus,
  renameCity,
  startTech,
  type AppliedPublicServiceUsage,
  type CityBuilding,
  type CityMudBridgeStatusResponse,
  type HeroRole,
  type ArmyType,
  type InfrastructureMode,
  type MeProfile,
  type PublicInfrastructureStatusResponse,
  type PublicServiceQuote,
  type Resources,
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
  const [serviceMode, setServiceMode] = useState<InfrastructureMode>("private_city");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [cityNameDraft, setCityNameDraft] = useState("");
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
      const [data, infra, bridge] = await Promise.all([fetchMe(), fetchPublicInfrastructureStatus(mode), fetchCityMudBridgeStatus()]);
      setMe(data);
      setInfraStatus(infra);
      setBridgeStatus(bridge);
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
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(["valor_charm", "scouting_cloak", "arcane_focus"] as const).map((kind) => (
                        <button
                          key={kind}
                          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
                          disabled={disabled}
                          onClick={() => void handleEquipHeroAttachment(hero.id, kind)}
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
              <div><strong>{army.name}</strong> ({army.type}) • power {army.power} • size {army.size} • {army.status}</div>
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
