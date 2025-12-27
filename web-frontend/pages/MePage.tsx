//frontend/src/pages/MePage.tsx

import { useEffect, useState } from "react";
import {
  fetchMe,
  MeProfile,
  CityBuilding,
  API_BASE_URL,
  startTech,
} from "../lib/api";

const REGION_META: Record<
  string,
  { name: string }
> = {
  ancient_elwynn: { name: "Ancient Elwynn" },
  heartland_basin: { name: "Heartland Basin" },
  sunfall_coast: { name: "Sunfall Coast" },
  duskwood_border: { name: "Duskwood Border" },
  // add more as you introduce them; unknown ones will fall back to the raw id
};

function getRegionDisplayName(regionId: string): string {
  const meta = REGION_META[regionId];
  if (meta?.name) return meta.name;
  // fallback: convert snake_case → Title Case
  return regionId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ---- building cost helpers ----

function getBuildingUpgradeCost(b: CityBuilding) {
  let baseMaterials = 0;
  let baseWealth = 0;

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
      baseMaterials = 20;
      baseWealth = 10;
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

  const [now, setNow] = useState<number>(() => Date.now());
  const [tickCountdown, setTickCountdown] = useState<number | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(
    null);


  const refreshMe = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMe();
      setMe(data);

      if (data.lastTickAt && data.tickMs) {
        const last = new Date(data.lastTickAt).getTime();
        const next = last + data.tickMs;
        const remainingMs = Math.max(0, next - Date.now());
        setTickCountdown(Math.floor(remainingMs / 1000));
      } else {
        setTickCountdown(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Failed to refresh /me");
    } finally {
      setLoading(false);
    }
  };

  // initial load
  useEffect(() => {
    void refreshMe();
  }, []);

  // now timer for mission progress
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // tick countdown
  useEffect(() => {
    if (tickCountdown === null || !me?.tickMs) return;

    const id = window.setInterval(() => {
      setTickCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [tickCountdown, me?.tickMs, me?.id]);

  // ---- API handlers ----

  const handleStartMission = async (missionId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/missions/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as any).error || `Start failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Mission start response:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to start mission.");
    }
  };

  const handleCompleteMission = async (instanceId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/missions/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as any).error || `Complete failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Mission complete response:", data);

      const outcome = data?.result?.outcome;
      if (outcome) {
        const casualtyPct = Math.round((outcome.casualtyRate ?? 0) * 100);
        alert(
          `Mission outcome: ${String(outcome.kind).toUpperCase()}\nCasualties: ${casualtyPct}%`
        );
      }

      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to complete mission.");
    }
  };

  const handleRefreshRegionMissions = async (regionId: string) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/missions/refresh_region`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regionId }),
        }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error ||
          `Region mission refresh failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }

      const data = await res.json();
      console.log("Region missions refreshed:", data);

      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to refresh missions for region.");
    }
  };

  const handleBuildBuilding = async (
    kind: "housing" | "farmland" | "mine" | "arcane_spire"
  ) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/buildings/construct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error || `Build failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Build building:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to construct building.");
    }
  };

  const handleUpgradeBuilding = async (buildingId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/buildings/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error || `Upgrade failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Upgrade building:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to upgrade building.");
    }
  };

  const handleTierUpCity = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/city/tier-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as any).error || `Tier up failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Tier up response:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to tier up city.");
    }
  };

  const handleWarfrontAssault = async (regionId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/warfront/assault`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error || `Assault failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Warfront assault:", data);
      alert("Assault staged: forces deployed to the front.");
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to stage assault.");
    }
  };

  const handleRaiseArmy = async (type: "militia" | "line" | "vanguard") => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/armies/raise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as any).error || `Raise failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Raise army response:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to raise army.");
    }
  };

  const handleReinforceArmy = async (armyId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/armies/reinforce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ armyId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error || `Reinforce failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Reinforce army response:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to reinforce army.");
    }
  };

  const handleGarrisonStrike = async (regionId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/garrisons/strike`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error || `Garrison strike failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Garrison strike:", data);
      alert("Hero raid dispatched to the region.");
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to start garrison strike.");
    }
  };

  const handleEquipHeroAttachment = async (
    heroId: string,
    kind: "valor_charm" | "scouting_cloak" | "arcane_focus"
  ) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/heroes/equip_attachment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ heroId, kind }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error || `Equip failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Equip hero attachment:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to equip hero gear.");
    }
  };

  const handleRecruitHero = async (
    role: "champion" | "scout" | "tactician" | "mage"
  ) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/heroes/recruit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error || `Recruit failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Recruit hero:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to recruit hero.");
    }
  };

  const handleWorkshopCraft = async (
    kind: "valor_charm" | "scouting_cloak" | "arcane_focus"
  ) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/workshop/craft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error || `Craft failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Workshop craft:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to start workshop craft.");
    }
  };

  const handleWorkshopCollect = async (jobId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/workshop/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as any).error || `Collect failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Workshop collect:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to complete workshop job.");
    }
  };

  const handleTogglePolicy = async (key: keyof MeProfile["policies"]) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/policies/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: !me?.policies[key] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as any).error || `Toggle failed: ${res.status}`;
        alert(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      console.log("Policy toggle response:", data);
      await refreshMe();
    } catch (err) {
      console.error(err);
      alert("Failed to toggle policy.");
    }
  };

  const handleStartTech = async (techId: string) => {
    try {
      await startTech(techId);
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err.message ?? "Failed to start tech");
    }
  };

  if (loading && !me) {
    return <p>Loading /me...</p>;
  }

  if (error) {
    return (
      <section style={{ padding: 16 }}>
        <h2>/me</h2>
        <p style={{ color: "salmon" }}>{error}</p>
        <button onClick={() => void refreshMe()}>Retry</button>
      </section>
    );
  }

  if (!me) {
    return (
      <section style={{ padding: 16 }}>
        <h2>/me</h2>
        <p>No data.</p>
      </section>
    );
  }

  const stress = me.cityStress; 
  const city = me.city;
  const missions = me.missions ?? [];
  const activeMissions = me.activeMissions ?? [];

  const filteredMissions =
    selectedRegionId == null
      ? missions
      : missions.filter((m) => m.regionId === selectedRegionId);

  return (
    <section style={{ padding: 16, display: "grid", gap: 16 }}>
      <h2>/me</h2>

      {/* Commander summary */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 4,
        }}
      >
        <div>
          <strong>ID:</strong> {me.id}
        </div>
        <div>
          <strong>Name:</strong> {me.displayName}
        </div>
        <div>
          <strong>Faction:</strong> {me.faction}
        </div>
        <div>
          <strong>Rank:</strong> {me.rank}
        </div>
        <div>
          <strong>Last Login:</strong>{" "}
          {new Date(me.lastLoginAt).toLocaleString()}
        </div>
        <div>
          <strong>Last Tick:</strong>{" "}
          {new Date(me.lastTickAt).toLocaleString()}
        </div>
        <div>
          <strong>Tick Length:</strong> {me.tickMs / 1000}s
        </div>
        <div>
          <strong>Next Tick In:</strong>{" "}
          {tickCountdown !== null ? `${tickCountdown}s` : "n/a"}
        </div>
      </div>

      {/* City + resources */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1.5fr",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        {/* City */}
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            display: "grid",
            gap: 6,
          }}
        >
          <h3 style={{ marginTop: 0 }}>City</h3>
          <div>
            <strong>Name:</strong> {city.name}
          </div>
          <div>
            <strong>Shard:</strong> {city.shardId}
          </div>
          <div>
            <strong>Region:</strong> {city.regionId}
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
            <strong>Building Slots:</strong> {city.buildingSlotsUsed} /{" "}
            {city.buildingSlotsMax}
          </div>
          <button
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
            }}
            onClick={handleTierUpCity}
          >
            Tier Up City
          </button>
          <div>
            <strong>Stats:</strong>
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
            {/* City stress */}
        {stress && (
          <div
            style={{
              marginTop: 4,
              marginBottom: 4,
              fontSize: 13,
            }}
          >
            <strong>City Tension:</strong>{" "}
            <span>
              {stress.stage.charAt(0).toUpperCase() +
                stress.stage.slice(1)}{" "}
              ({stress.total})
            </span>
            <div
              style={{
                width: "100%",
                height: 8,
                borderRadius: 4,
                border: "1px solid #666",
                background: "#111",
                overflow: "hidden",
                marginTop: 2,
              }}
            >
              <div
                style={{
                  width: `${stress.total}%`,
                  height: "100%",
                  background:
                    stress.total < 25
                      ? "linear-gradient(to right, #22c55e, #16a34a)"
                      : stress.total < 50
                      ? "linear-gradient(to right, #eab308, #f97316)"
                      : stress.total < 75
                      ? "linear-gradient(to right, #f97316, #ef4444)"
                      : "linear-gradient(to right, #ef4444, #b91c1c)",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                fontSize: 11,
                opacity: 0.8,
                marginTop: 2,
                flexWrap: "wrap",
              }}
            >
              <span>Food pressure: {stress.foodPressure}</span>
              <span>Threat pressure: {stress.threatPressure}</span>
              <span>Unity pressure: {stress.unityPressure}</span>
            </div>
          </div>
        )}
          </div>
        </div>

        {/* Resources */}
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            display: "grid",
            gap: 4,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Resources</h3>
          <div>
            <strong>Food:</strong> {me.resources.food}
          </div>
          <div>
            <strong>Materials:</strong> {me.resources.materials}
          </div>
          <div>
            <strong>Wealth:</strong> {me.resources.wealth}
          </div>
          <div>
            <strong>Mana:</strong> {me.resources.mana}
          </div>
          <div>
            <strong>Knowledge:</strong> {me.resources.knowledge}
          </div>
          <div>
            <strong>Unity:</strong> {me.resources.unity}
          </div>
          <h4 style={{ marginTop: 8, marginBottom: 4 }}>Per-Tick Output</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            <li>Food: {city.production.foodPerTick}</li>
            <li>Materials: {city.production.materialsPerTick}</li>
            <li>Wealth: {city.production.wealthPerTick}</li>
            <li>Mana: {city.production.manaPerTick}</li>
            <li>Knowledge: {city.production.knowledgePerTick}</li>
            <li>Unity: {city.production.unityPerTick}</li>
          </ul>
        </div>
      </div>
      {/* World Map (mini) */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 8,
        }}
      >
        <h3 style={{ marginTop: 0 }}>World Map</h3>
        <p style={{ fontSize: 13, marginTop: 0, opacity: 0.85 }}>
          Each tile represents a region around your city. Click a region to
          focus its front and missions.
        </p>

        {me.regionWar.length === 0 ? (
          <p style={{ fontSize: 14 }}>No mapped regions yet.</p>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
                fontSize: 13,
              }}
            >
              {me.regionWar.map((rw) => {
                const controlPct = Math.round(rw.control);
                const threatPct = Math.round(rw.threat);
                const selected = rw.regionId === selectedRegionId;

                return (
                  <button
                    key={rw.regionId}
                    onClick={() =>
                      setSelectedRegionId((prev) =>
                        prev === rw.regionId ? null : rw.regionId
                      )
                    }
                    style={{
                      textAlign: "left",
                      borderRadius: 8,
                      padding: 8,
                      border: selected
                        ? "2px solid #eab308"
                        : "1px solid #555",
                      background: selected ? "#1f2933" : "#050608",
                      cursor: "pointer",
                      display: "grid",
                      gap: 4,
                    }}
                  ><div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    fontSize: 11,
                  }}
                >
                  <span style={{ opacity: 0.85 }}>
                    {selected ? "Focused" : "Click to focus"}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRefreshRegionMissions(rw.regionId);
                    }}
                    style={{
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: "1px solid #666",
                      background: "#111",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    Refresh missions here
                  </button>
                </div>
                    <div>
                      <strong>
                        {getRegionDisplayName(rw.regionId)}
                      </strong>
                    </div>
                    
                    <div style={{ fontSize: 11, opacity: 0.9 }}>
                      Control {controlPct} · Threat {threatPct}
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: 6,
                        borderRadius: 4,
                        border: "1px solid #444",
                        background: "#020309",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${controlPct}%`,
                          height: "100%",
                          background:
                            "linear-gradient(to right, #22c55e, #16a34a)",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: 6,
                        borderRadius: 4,
                        border: "1px solid #444",
                        background: "#020309",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${threatPct}%`,
                          height: "100%",
                          background:
                            "linear-gradient(to right, #f97316, #ef4444)",
                        }}
                      />
                    </div>
                    {selected && (
                      <div
                        style={{
                          fontSize: 11,
                          marginTop: 2,
                          opacity: 0.9,
                          color: "#eab308",
                        }}
                      >
                        Focused – missions list is filtered.
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedRegionId && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  opacity: 0.85,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  Focused region:{" "}
                  <strong>
                    {getRegionDisplayName(selectedRegionId)}
                  </strong>
                </span>
                <button
                  style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: "1px solid #666",
                    background: "#111",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                  onClick={() => setSelectedRegionId(null)}
                >
                  Clear focus
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {/* Forces + Warfront */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 2fr",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
         {/* Forces */}
         <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            display: "grid",
            gap: 8,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Forces</h3>

          {/* Raise army controls */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <button
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid #888",
                background: "#111",
                cursor: "pointer",
                fontSize: 13,
              }}
              onClick={() => handleRaiseArmy("militia")}
            >
              Raise Militia
            </button>
            <button
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid #888",
                background: "#111",
                cursor: "pointer",
                fontSize: 13,
              }}
              onClick={() => handleRaiseArmy("line")}
            >
              Raise Line Regiment
            </button>
            <button
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid #888",
                background: "#111",
                cursor: "pointer",
                fontSize: 13,
              }}
              onClick={() => handleRaiseArmy("vanguard")}
            >
              Raise Vanguard
            </button>
          </div>

          <div>
            <strong>Heroes</strong>
          </div>
          {me.heroes.length === 0 ? (
            <p style={{ fontSize: 14 }}>No heroes yet.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 4,
                fontSize: 14,
                marginBottom: 8,
              }}
            >
                {me.heroes.map((h) => {
                const hasProgress =
                  h.level != null &&
                  h.xp != null &&
                  h.xpToNext != null &&
                  h.xpToNext > 0;

                const progressPct = hasProgress
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        Math.round((h.xp! / h.xpToNext!) * 100)
                      )
                    )
                  : 0;

                const attachments = h.attachments ?? [];

                return (
                  <div
                    key={h.id}
                    style={{
                      border: "1px solid #555",
                      borderRadius: 6,
                      padding: 6,
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    <div>
                      <strong>{h.name}</strong> ({h.role})
                    </div>
                    <div>Power: {h.power}</div>
                    {hasProgress && (
                      <>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>
                          Level {h.level} — XP {h.xp} / {h.xpToNext}
                        </div>
                        <div
                          style={{
                            width: "100%",
                            height: 6,
                            borderRadius: 4,
                            border: "1px solid #666",
                            background: "#111",
                            overflow: "hidden",
                            marginTop: 2,
                            marginBottom: 4,
                          }}
                        >
                          <div
                            style={{
                              width: `${progressPct}%`,
                              height: "100%",
                              background:
                                "linear-gradient(to right, #38bdf8, #0ea5e9)",
                            }}
                          />
                        </div>
                      </>
                    )}
                    {/* Hero recruitment */}
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          <span style={{ opacity: 0.9 }}>Recruit hero:</span>
          <button
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 11,
            }}
            onClick={() => handleRecruitHero("champion")}
          >
            Champion
          </button>
          <button
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 11,
            }}
            onClick={() => handleRecruitHero("scout")}
          >
            Scout
          </button>
          <button
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 11,
            }}
            onClick={() => handleRecruitHero("tactician")}
          >
            Tactician
          </button>
          <button
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 11,
            }}
            onClick={() => handleRecruitHero("mage")}
          >
            Mage
          </button>
        </div>

                    {/* Gear list */}
                    <div style={{ fontSize: 12 }}>
                      <strong>Gear:</strong>{" "}
                      {attachments.length === 0
                        ? "None"
                        : attachments.map((a) => a.name).join(", ")}
                    </div>

                    {/* Simple equip controls */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        marginTop: 4,
                      }}
                    >
                      <button
                        style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          border: "1px solid #888",
                          background: "#111",
                          cursor: "pointer",
                          fontSize: 11,
                        }}
                        onClick={() =>
                          handleEquipHeroAttachment(h.id, "valor_charm")
                        }
                      >
                        Equip Valor Charm
                      </button>
                      <button
                        style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          border: "1px solid #888",
                          background: "#111",
                          cursor: "pointer",
                          fontSize: 11,
                        }}
                        onClick={() =>
                          handleEquipHeroAttachment(h.id, "scouting_cloak")
                        }
                      >
                        Equip Scouting Cloak
                      </button>
                      <button
                        style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          border: "1px solid #888",
                          background: "#111",
                          cursor: "pointer",
                          fontSize: 11,
                        }}
                        onClick={() =>
                          handleEquipHeroAttachment(h.id, "arcane_focus")
                        }
                      >
                        Equip Arcane Focus
                      </button>
                    </div>

                    <div>Status: {h.status}</div>
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <strong>Armies</strong>
          </div>
          {me.armies.length === 0 ? (
            <p style={{ fontSize: 14 }}>No armies yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
              {me.armies.map((a) => {
                const canReinforce = a.status === "idle";
                return (
                  <div
                    key={a.id}
                    style={{
                      border: "1px solid #555",
                      borderRadius: 6,
                      padding: 6,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div>
                      <div>
                        <strong>{a.name}</strong> ({a.type})
                      </div>
                      <div>Power: {a.power}</div>
                      <div>Size: {a.size}</div>
                      <div>Status: {a.status}</div>
                    </div>
                    <button
                      style={{
                        padding: "4px 8px",
                        borderRadius: 4,
                        border: "1px solid #888",
                        background: canReinforce ? "#111" : "#222",
                        cursor: canReinforce ? "pointer" : "default",
                        opacity: canReinforce ? 1 : 0.5,
                        fontSize: 13,
                      }}
                      onClick={() => canReinforce && handleReinforceArmy(a.id)}
                      disabled={!canReinforce}
                    >
                      Reinforce
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Warfront */}
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            display: "grid",
            gap: 8,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Warfront</h3>
          {me.regionWar.length === 0 ? (
            <p style={{ fontSize: 14 }}>No known fronts yet.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
                fontSize: 14,
              }}
            >
              {me.regionWar.map((rw) => {
                const controlPct = Math.round(rw.control);
                const threatPct = Math.round(rw.threat);
                const selected = rw.regionId === selectedRegionId;
                return (
                  <div
                    key={rw.regionId}
                    onClick={() =>
                      setSelectedRegionId((prev) =>
                        prev === rw.regionId ? null : rw.regionId
                      )
                    }
                    style={{
                      border: selected
                        ? "2px solid #eab308"
                        : "1px solid #555",
                      borderRadius: 8,
                      padding: 10,
                      display: "grid",
                      gap: 4,
                      cursor: "pointer",
                      background: selected ? "#111827" : "transparent",
                    }}
                  >
                    <div>
                      <strong>{rw.regionId}</strong>
                    </div>
                    <div>Control: {controlPct}</div>
                    <div
                      style={{
                        width: "100%",
                        height: 8,
                        borderRadius: 4,
                        border: "1px solid #666",
                        background: "#111",
                        overflow: "hidden",
                        marginBottom: 4,
                      }}
                    >
                      <div
                        style={{
                          width: `${controlPct}%`,
                          height: "100%",
                          background:
                            "linear-gradient(to right, #22c55e, #16a34a)",
                        }}
                      />
                    </div>
                    <div>Threat: {threatPct}</div>
                    <div
                      style={{
                        width: "100%",
                        height: 8,
                        borderRadius: 4,
                        border: "1px solid #666",
                        background: "#111",
                        overflow: "hidden",
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          width: `${threatPct}%`,
                          height: "100%",
                          background:
                            "linear-gradient(to right, #f97316, #ef4444)",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        marginTop: 4,
                      }}
                    >
                      <button
                        style={{
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: "1px solid #888",
                          background: "#111",
                          cursor: "pointer",
                          fontSize: 13,
                        }}
                        onClick={() =>
                          handleWarfrontAssault(rw.regionId)
                        }
                      >
                        Stage Assault (Army)
                      </button>
                      <button
                        style={{
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: "1px solid #888",
                          background: "#111",
                          cursor: "pointer",
                          fontSize: 13,
                        }}
                        onClick={() =>
                          handleGarrisonStrike(rw.regionId)
                        }
                      >
                        Hero Raid (Garrison)
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* Workshop */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 8,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Workshop</h3>
        <p style={{ fontSize: 13, marginTop: 0 }}>
          Craft hero attachments over time. When a job finishes, the item is
          automatically equipped on a suitable hero.
        </p>

        {/* Craft recipes */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <button
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => handleWorkshopCraft("valor_charm")}
          >
            Craft Valor Charm
          </button>
          <button
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => handleWorkshopCraft("scouting_cloak")}
          >
            Craft Scouting Cloak
          </button>
          <button
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => handleWorkshopCraft("arcane_focus")}
          >
            Craft Arcane Focus
          </button>
        </div>

        {/* Active jobs */}
        {!me.workshopJobs || me.workshopJobs.length === 0 ? (
          <p style={{ fontSize: 14 }}>No active workshop jobs.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 4,
              fontSize: 13,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {me.workshopJobs.map((job) => {
              const now = Date.now();
              const start = new Date(job.startedAt).getTime();
              const finish = new Date(job.finishesAt).getTime();
              const total = Math.max(0, finish - start);
              const elapsed = Math.max(0, now - start);
              const pct =
                total > 0
                  ? Math.max(
                      0,
                      Math.min(100, Math.round((elapsed / total) * 100))
                    )
                  : job.completed
                  ? 100
                  : 0;

              const ready = !job.completed && now >= finish;

              const label =
                job.attachmentKind === "valor_charm"
                  ? "Valor Charm"
                  : job.attachmentKind === "scouting_cloak"
                  ? "Scouting Cloak"
                  : "Arcane Focus";

              return (
                <div
                  key={job.id}
                  style={{
                    border: "1px solid #555",
                    borderRadius: 6,
                    padding: 6,
                    display: "grid",
                    gap: 4,
                  }}
                >
                  <div>
                    <strong>{label}</strong>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>
                    {job.completed
                      ? "Completed"
                      : ready
                      ? "Ready to collect"
                      : `Finishes at ${new Date(
                          job.finishesAt
                        ).toLocaleTimeString()}`}
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: 6,
                      borderRadius: 4,
                      border: "1px solid #666",
                      background: "#111",
                      overflow: "hidden",
                      marginTop: 2,
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background:
                          "linear-gradient(to right, #a855f7, #6366f1)",
                      }}
                    />
                  </div>
                  <button
                    style={{
                      padding: "4px 8px",
                      borderRadius: 4,
                      border: "1px solid #888",
                      background: ready ? "#111" : "#222",
                      cursor: ready ? "pointer" : "default",
                      opacity: ready ? 1 : 0.5,
                      fontSize: 12,
                    }}
                    onClick={() =>
                      ready && handleWorkshopCollect(job.id)
                    }
                    disabled={!ready}
                  >
                    {job.completed ? "Completed" : "Complete & Equip"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Operations Log */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 8,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Operations Log</h3>
        {!me.events || me.events.length === 0 ? (
          <p style={{ fontSize: 14 }}>No major events yet.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 4,
              fontSize: 13,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {me.events.map((evt) => (
              <div
                key={evt.id}
                style={{
                  borderBottom: "1px solid #333",
                  paddingBottom: 4,
                  marginBottom: 4,
                }}
              >
                <div style={{ opacity: 0.7, fontSize: 11 }}>
                  {new Date(evt.timestamp).toLocaleString()} ·{" "}
                  {evt.kind}
                </div>
                <div>{evt.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Policies */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 8,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Policies</h3>
        <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
          {(Object.keys(me.policies) as (keyof MeProfile["policies"])[]).map(
            (key) => (
              <label
                key={key}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <input
                  type="checkbox"
                  checked={me.policies[key]}
                  onChange={() => handleTogglePolicy(key)}
                />
                <span>{key}</span>
              </label>
            )
          )}
        </div>
      </div>

      {/* Research */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 8,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Research</h3>
        {me.activeResearch ? (
          <div
            style={{
              border: "1px solid #555",
              borderRadius: 6,
              padding: 8,
              display: "grid",
              gap: 4,
            }}
          >
            <div>
              <strong>{me.activeResearch.name}</strong> (
              {me.activeResearch.category})
            </div>
            <div style={{ fontSize: 14 }}>
              {me.activeResearch.description}
            </div>
            <div style={{ fontSize: 14 }}>
              Progress: {me.activeResearch.progress} / {me.activeResearch.cost}
            </div>
            <div
              style={{
                width: "100%",
                height: 10,
                borderRadius: 5,
                border: "1px solid #666",
                background: "#111",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(
                    100,
                    (me.activeResearch.progress / me.activeResearch.cost) * 100
                  )}%`,
                  height: "100%",
                  background:
                    "linear-gradient(to right, #3b82f6, #38bdf8)",
                }}
              />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14 }}>No active research.</p>
        )}

        <h4>Available Tech</h4>
        {me.availableTechs.length === 0 ? (
          <p style={{ fontSize: 14 }}>No tech available.</p>
        ) : (
          <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
            {me.availableTechs.map((t) => (
              <div
                key={t.id}
                style={{
                  border: "1px solid #555",
                  borderRadius: 6,
                  padding: 6,
                }}
              >
                <div>
                  <strong>{t.name}</strong> ({t.category}) – Cost: {t.cost}
                </div>
                <div>{t.description}</div>
                <button
                  style={{
                    marginTop: 4,
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid #888",
                    background: "#111",
                    cursor: "pointer",
                  }}
                  onClick={() => handleStartTech(t.id)}
                  disabled={!!me.activeResearch}
                >
                  Start Research
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
          <strong>Buildings</strong>
        </div>

      {/* Build controls */}
      <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <button
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => handleBuildBuilding("housing")}
          >
            Build Housing
          </button>
          <button
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => handleBuildBuilding("farmland")}
          >
            Build Farmland
          </button>
          <button
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => handleBuildBuilding("mine")}
          >
            Build Mine
          </button>
          <button
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #888",
              background: "#111",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => handleBuildBuilding("arcane_spire")}
          >
            Build Arcane Spire
          </button>
        </div>

        {me.city.buildings.length === 0 ? (
          <p style={{ fontSize: 14 }}>No buildings yet.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 4,
              fontSize: 14,
            }}
          >
            {me.city.buildings.map((b) => (
              <div
                key={b.id}
                style={{
                  border: "1px solid #555",
                  borderRadius: 6,
                  padding: 6,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div>
                  <div>
                    <strong>{b.name}</strong> ({b.kind})
                  </div>
                  <div>Level: {b.level}</div>
                </div>
                <button
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid #888",
                    background: "#111",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                  onClick={() => handleUpgradeBuilding(b.id)}
                >
                  Upgrade
                </button>
              </div>
            ))}
          </div>
        )}

      {/* Missions */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Available Missions</h3>
        {selectedRegionId && (
          <p
            style={{
              fontSize: 12,
              opacity: 0.8,
              marginTop: 0,
              marginBottom: 4,
            }}
          >
            Showing missions for{" "}
            <strong>
              {getRegionDisplayName(selectedRegionId)}
            </strong>{" "}
            only.
          </p>
        )}
        {filteredMissions.length === 0 ? (
          <p>No missions generated.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 8,
            }}
          >
            {filteredMissions.map((m) => {
              const isQueued = activeMissions.some(
                (am) => am.mission.id === m.id
              );
              return (
                <div
                  key={m.id}
                  style={{
                    border: "1px solid #555",
                    borderRadius: 8,
                    padding: 12,
                    fontSize: 14,
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <strong>
                      {m.kind.toUpperCase()} – {m.difficulty.toUpperCase()}
                    </strong>
                  </div>
                  <div style={{ marginBottom: 8 }}>{m.title}</div>
                  <div style={{ marginBottom: 8, opacity: 0.8 }}>
                    {m.description}
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <strong>Region:</strong> {m.regionId}
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <strong>Recommended Power:</strong> {m.recommendedPower}
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <strong>Risk:</strong> {m.risk.casualtyRisk}
                    {m.risk.heroInjuryRisk
                      ? ` / hero: ${m.risk.heroInjuryRisk}`
                      : null}
                  </div>
                  {m.risk.notes && (
                    <div
                      style={{
                        marginBottom: 4,
                        fontSize: 12,
                        opacity: 0.85,
                        fontStyle: "italic",
                      }}
                    >
                      {m.risk.notes}
                    </div>
                  )}
                  <div style={{ marginBottom: 4 }}>
                    <strong>Status:</strong>{" "}
                    {isQueued ? "Queued" : "Available"}
                  </div>
                  <button
                    style={{
                      marginTop: 4,
                      padding: "4px 8px",
                      borderRadius: 4,
                      border: "1px solid #888",
                      background: isQueued ? "#222" : "#111",
                      cursor: isQueued ? "default" : "pointer",
                      opacity: isQueued ? 0.6 : 1,
                    }}
                    onClick={() => !isQueued && handleStartMission(m.id)}
                    disabled={isQueued}
                  >
                    {isQueued ? "Queued" : "Queue Mission"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <h3>Active Missions</h3>
        {activeMissions.length === 0 ? (
          <p style={{ fontSize: 14 }}>No active missions.</p>
        ) : (
          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            {activeMissions.map((am) => {
              const startedAt = new Date(am.startedAt).getTime();
              const finishesAt = new Date(am.finishesAt).getTime();
              const total = finishesAt - startedAt;
              const elapsed = Math.max(0, Math.min(total, now - startedAt));
              const pct = total > 0 ? (elapsed / total) * 100 : 100;
              const remainingSec = Math.max(
                0,
                Math.floor((finishesAt - now) / 1000)
              );
              const isComplete = now >= finishesAt;

              return (
                <div
                  key={am.instanceId}
                  style={{
                    border: "1px solid #555",
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  <div>
                    <strong>{am.mission.title}</strong> [{am.mission.kind}] (
                    {am.mission.difficulty})
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Region: {am.mission.regionId} | Recommended power:{" "}
                    {am.mission.recommendedPower}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Progress: {Math.min(100, Math.round(pct))}%
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: 8,
                      borderRadius: 4,
                      border: "1px solid #666",
                      background: "#111",
                      overflow: "hidden",
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, pct)}%`,
                        height: "100%",
                        background:
                          "linear-gradient(to right, #22c55e, #4ade80)",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Time remaining: {remainingSec}s
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <button
                      style={{
                        padding: "4px 8px",
                        borderRadius: 4,
                        border: "1px solid #888",
                        background: isComplete ? "#111" : "#222",
                        cursor: isComplete ? "pointer" : "default",
                        opacity: isComplete ? 1 : 0.6,
                      }}
                      onClick={() =>
                        isComplete && handleCompleteMission(am.instanceId)
                      }
                      disabled={!isComplete}
                    >
                      Claim Rewards
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
