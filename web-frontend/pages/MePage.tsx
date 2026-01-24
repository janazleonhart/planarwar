// web-frontend/pages/MePage.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  fetchMe,
  startTech,
  type MeProfile,
  type CityBuilding,
  type HeroRole,
  type ArmyType,
} from "../lib/api";

const REGION_META: Record<string, { name: string }> = {
  ancient_elwynn: { name: "Ancient Elwynn" },
  heartland_basin: { name: "Heartland Basin" },
  sunfall_coast: { name: "Sunfall Coast" },
  duskwood_border: { name: "Duskwood Border" },
};

function getRegionDisplayName(regionId: string): string {
  const meta = REGION_META[regionId];
  if (meta?.name) return meta.name;
  return regionId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ---- building cost helpers (UI-only heuristics) ----

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

export function MePage() {
  const [me, setMe] = useState<MeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const noticeTimer = useRef<number | null>(null);
  const setFlash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
  };

  const refreshMe = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMe();
      setMe(data);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Failed to refresh /api/me");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshMe();
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const runAction = async (label: string, fn: () => Promise<void>) => {
    if (busyAction) return;
    setBusyAction(label);
    setError(null);
    try {
      await fn();
      await refreshMe();
      setFlash("ok", `${label} ✓`);
    } catch (err: any) {
      console.error(err);
      setFlash("err", err?.message ?? `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  };

  // -----------------------
  // API handlers (same-origin)
  // -----------------------

  const handleBuildBuilding = (kind: CityBuilding["kind"]) =>
    runAction(`Build ${kind}`, async () => {
      await api("/api/buildings/construct", {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
    });

  const handleUpgradeBuilding = (buildingId: string) =>
    runAction("Upgrade building", async () => {
      await api("/api/buildings/upgrade", {
        method: "POST",
        body: JSON.stringify({ buildingId }),
      });
    });

  const handleTierUpCity = () =>
    runAction("Tier up city", async () => {
      await api("/api/city/tier-up", {
        method: "POST",
        body: JSON.stringify({}),
      });
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
    runAction(`Recruit ${role}`, async () => {
      await api("/api/heroes/recruit", {
        method: "POST",
        body: JSON.stringify({ role }),
      });
    });

  const handleEquipHeroAttachment = (
    heroId: string,
    kind: "valor_charm" | "scouting_cloak" | "arcane_focus"
  ) =>
    runAction("Equip attachment", async () => {
      await api("/api/heroes/equip_attachment", {
        method: "POST",
        body: JSON.stringify({ heroId, kind }),
      });
    });

  const handleWorkshopCraft = (kind: "valor_charm" | "scouting_cloak" | "arcane_focus") =>
    runAction(`Craft ${kind}`, async () => {
      await api("/api/workshop/craft", {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
    });

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
    runAction(`Start tech ${techId}`, async () => {
      await startTech(techId);
    });

  // -----------------------
  // Derived display bits
  // -----------------------

  const city = me?.city ?? null;
  const cityHeader = city ? `${city.name} (Tier ${city.tier})` : "No city yet";

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

  // -----------------------
  // Render
  // -----------------------

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
          onClick={() => void refreshMe()}
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

      {busyAction ? (
        <div style={{ fontSize: 13, opacity: 0.8 }}>Working: {busyAction}…</div>
      ) : null}

      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 6,
        }}
      >
        <div>
          <strong>User:</strong> {(me as any).username ?? "(unknown)"}{" "}
          <span style={{ opacity: 0.7 }}>({(me as any).userId ?? "?"})</span>
        </div>
        <div>
          <strong>City:</strong> {cityHeader}
        </div>
      </div>

      {/* Resources */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 6,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Resources</h3>
        <div>Food: {(me as any).resources?.food ?? 0}</div>
        <div>Materials: {(me as any).resources?.materials ?? 0}</div>
        <div>Wealth: {(me as any).resources?.wealth ?? 0}</div>
        <div>Mana: {(me as any).resources?.mana ?? 0}</div>
        <div>Knowledge: {(me as any).resources?.knowledge ?? 0}</div>
        <div>Unity: {(me as any).resources?.unity ?? 0}</div>
      </div>

      {/* City */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ marginTop: 0 }}>City</h3>

        {!city ? (
          <p style={{ opacity: 0.85 }}>
            No city attached to this profile yet. (Now that you have DB-enforced 1-city-per-account,
            this page can safely become the “create city” funnel later.)
          </p>
        ) : (
          <>
            <div style={{ display: "grid", gap: 4 }}>
              <div>
                <strong>ID:</strong> {city.id}
              </div>
              <div>
                <strong>Shard:</strong> {city.shardId}
              </div>
              <div>
                <strong>Region:</strong> {getRegionDisplayName(city.regionId)}{" "}
                <span style={{ opacity: 0.7 }}>({city.regionId})</span>
              </div>
              <div>
                <strong>Tier:</strong> {city.tier}
              </div>
              <div>
                <strong>Specialization:</strong>{" "}
                {city.specializationId
                  ? `${city.specializationId} (★${city.specializationStars})`
                  : "None"}
              </div>
              <div>
                <strong>Slots:</strong> {city.buildingSlotsUsed} / {city.buildingSlotsMax}
              </div>

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

            <div
              style={{
                border: "1px solid #555",
                borderRadius: 8,
                padding: 12,
                display: "grid",
                gap: 8,
              }}
            >
              <strong>Construct building</strong>
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
                      <div
                        key={b.id}
                        style={{
                          border: "1px solid #555",
                          borderRadius: 8,
                          padding: 10,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div>
                          <div>
                            <strong>{b.name}</strong> ({b.kind})
                          </div>
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

            {/* Tech */}
            <div style={{ display: "grid", gap: 8 }}>
              <strong>Tech</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(me as any).techOptions?.map?.((t: any) => (
                  <button
                    key={t.techId}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid #777",
                      background: "#111",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.6 : 1,
                    }}
                    disabled={disabled}
                    onClick={() => void handleStartTech(t.techId)}
                    title={t.description ?? t.techId}
                  >
                    Start: {t.name ?? t.techId}
                  </button>
                ))}
                {!(me as any).techOptions?.length ? (
                  <span style={{ opacity: 0.7, fontSize: 13 }}>No tech options (yet).</span>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #777",
            background: "#111",
            cursor: "pointer",
          }}
          onClick={() => void refreshMe()}
        >
          Refresh
        </button>
        <span style={{ opacity: 0.65, fontSize: 12 }}>
          Tip: if CityBuilder ever misbehaves, it should now fail *inside the panel*, not blank the whole app.
        </span>
      </div>
    </section>
  );
}
