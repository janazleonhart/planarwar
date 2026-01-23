// web-frontend/pages/MePage.tsx

import { useEffect, useMemo, useState } from "react";
import {
  api,
  fetchMe,
  MeProfile,
  CityBuilding,
  startTech,
  HeroRole,
  ArmyType,
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
  }, []);

  // -----------------------
  // API handlers (same-origin)
  // -----------------------

  const handleBuildBuilding = async (kind: CityBuilding["kind"]) => {
    try {
      await api("/api/buildings/construct", {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to construct building.");
    }
  };

  const handleUpgradeBuilding = async (buildingId: string) => {
    try {
      await api("/api/buildings/upgrade", {
        method: "POST",
        body: JSON.stringify({ buildingId }),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to upgrade building.");
    }
  };

  const handleTierUpCity = async () => {
    try {
      await api("/api/city/tier-up", {
        method: "POST",
        body: JSON.stringify({}),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to tier up city.");
    }
  };

  const handleRaiseArmy = async (type: ArmyType) => {
    try {
      await api("/api/armies/raise", {
        method: "POST",
        body: JSON.stringify({ type }),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to raise army.");
    }
  };

  const handleReinforceArmy = async (armyId: string) => {
    try {
      await api("/api/armies/reinforce", {
        method: "POST",
        body: JSON.stringify({ armyId }),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to reinforce army.");
    }
  };

  const handleRecruitHero = async (role: HeroRole) => {
    try {
      await api("/api/heroes/recruit", {
        method: "POST",
        body: JSON.stringify({ role }),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to recruit hero.");
    }
  };

  const handleEquipHeroAttachment = async (
    heroId: string,
    kind: "valor_charm" | "scouting_cloak" | "arcane_focus"
  ) => {
    try {
      await api("/api/heroes/equip_attachment", {
        method: "POST",
        body: JSON.stringify({ heroId, kind }),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to equip hero attachment.");
    }
  };

  const handleWorkshopCraft = async (
    kind: "valor_charm" | "scouting_cloak" | "arcane_focus"
  ) => {
    try {
      await api("/api/workshop/craft", {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to start workshop craft.");
    }
  };

  const handleWorkshopCollect = async (jobId: string) => {
    try {
      await api("/api/workshop/collect", {
        method: "POST",
        body: JSON.stringify({ jobId }),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to collect workshop job.");
    }
  };

  const handleTogglePolicy = async (key: keyof MeProfile["policies"]) => {
    if (!me) return;
    try {
      await api("/api/policies/toggle", {
        method: "POST",
        body: JSON.stringify({ key, value: !me.policies[key] }),
      });
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to toggle policy.");
    }
  };

  const handleStartTech = async (techId: string) => {
    try {
      await startTech(techId);
      await refreshMe();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to start tech.");
    }
  };

  // -----------------------
  // Render
  // -----------------------

  if (loading && !me) return <p>Loading /api/me...</p>;

  if (error) {
    return (
      <section style={{ padding: 16 }}>
        <h2>CityBuilder /me</h2>
        <p style={{ color: "salmon" }}>{error}</p>
        <button onClick={() => void refreshMe()}>Retry</button>
      </section>
    );
  }

  if (!me) {
    return (
      <section style={{ padding: 16 }}>
        <h2>CityBuilder /me</h2>
        <p>No data.</p>
      </section>
    );
  }

  const city = me.city;

  const cityHeader = useMemo(() => {
    if (!city) return "No city yet";
    return `${city.name} (Tier ${city.tier})`;
  }, [city]);

  return (
    <section style={{ padding: 16, display: "grid", gap: 16 }}>
      <h2>CityBuilder /me</h2>

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
          <strong>User:</strong> {me.username} <span style={{ opacity: 0.7 }}>({me.userId})</span>
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
        <div>Food: {me.resources.food}</div>
        <div>Materials: {me.resources.materials}</div>
        <div>Wealth: {me.resources.wealth}</div>
        <div>Mana: {me.resources.mana}</div>
        <div>Knowledge: {me.resources.knowledge}</div>
        <div>Unity: {me.resources.unity}</div>
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
            No city attached to this profile yet. (That’s fine — CityBuilder isn’t in active use,
            but this page now typechecks cleanly.)
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
                  cursor: "pointer",
                  width: "fit-content",
                }}
                onClick={handleTierUpCity}
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
                        cursor: "pointer",
                      }}
                      onClick={() => handleBuildBuilding(kind)}
                      title={`Cost: ${cost.materials} materials, ${cost.wealth} wealth`}
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
                            cursor: "pointer",
                          }}
                          onClick={() => handleUpgradeBuilding(b.id)}
                          title={`Est. cost: ${cost.materials} materials, ${cost.wealth} wealth`}
                        >
                          Upgrade (m{cost.materials}/w{cost.wealth})
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* City stress (new model) */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 6,
        }}
      >
        <h3 style={{ marginTop: 0 }}>City Stress</h3>
        <div>Hunger: {me.cityStress.hunger}</div>
        <div>Unrest: {me.cityStress.unrest}</div>
        <div>Corruption: {me.cityStress.corruption}</div>
        <div>Arcane Hazard: {me.cityStress.arcaneHazard}</div>
      </div>

      {/* Region war */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Region War</h3>
        {me.regionWar.length === 0 ? (
          <p style={{ opacity: 0.85 }}>No region war data.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {me.regionWar.map((rw) => (
              <div
                key={rw.regionId}
                style={{
                  border: "1px solid #555",
                  borderRadius: 8,
                  padding: 10,
                  display: "grid",
                  gap: 6,
                }}
              >
                <strong>{getRegionDisplayName(rw.regionId)}</strong>
                <div style={{ fontSize: 13, opacity: 0.85 }}>
                  Control {Math.round(rw.control)} · Threat {Math.round(rw.threat)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Forces */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Forces</h3>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
            onClick={() => handleRaiseArmy("militia")}
          >
            Raise Militia
          </button>
          <button
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
            onClick={() => handleRaiseArmy("line")}
          >
            Raise Line
          </button>
          <button
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
            onClick={() => handleRaiseArmy("vanguard")}
          >
            Raise Vanguard
          </button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <strong>Heroes</strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(["champion", "scout", "tactician", "mage"] as const).map((role) => (
              <button
                key={role}
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
                onClick={() => handleRecruitHero(role)}
              >
                Recruit {role}
              </button>
            ))}
          </div>

          {me.heroes.length === 0 ? (
            <p style={{ opacity: 0.85 }}>No heroes.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {me.heroes.map((h) => (
                <div
                  key={h.id}
                  style={{
                    border: "1px solid #555",
                    borderRadius: 8,
                    padding: 10,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div>
                    <strong>{h.name}</strong> ({h.role}) · Power {h.power} · Status {h.status}
                  </div>

                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    Level {h.level ?? "?"} · XP {h.xp ?? "?"} / {h.xpToNext ?? "?"}
                  </div>

                  <div style={{ fontSize: 13 }}>
                    Gear:{" "}
                    {h.attachments && h.attachments.length > 0
                      ? h.attachments.map((a) => a.name).join(", ")
                      : "None"}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
                      onClick={() => handleEquipHeroAttachment(h.id, "valor_charm")}
                    >
                      Equip Valor Charm
                    </button>
                    <button
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
                      onClick={() => handleEquipHeroAttachment(h.id, "scouting_cloak")}
                    >
                      Equip Scouting Cloak
                    </button>
                    <button
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
                      onClick={() => handleEquipHeroAttachment(h.id, "arcane_focus")}
                    >
                      Equip Arcane Focus
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <strong>Armies</strong>
          {me.armies.length === 0 ? (
            <p style={{ opacity: 0.85 }}>No armies.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {me.armies.map((a) => (
                <div
                  key={a.id}
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
                      <strong>{a.name}</strong> ({a.type})
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.85 }}>
                      Power {a.power} · Size {a.size} · Status {a.status}
                    </div>
                  </div>
                  <button
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid #777",
                      background: a.status === "idle" ? "#111" : "#222",
                      cursor: a.status === "idle" ? "pointer" : "default",
                      opacity: a.status === "idle" ? 1 : 0.6,
                    }}
                    onClick={() => a.status === "idle" && handleReinforceArmy(a.id)}
                    disabled={a.status !== "idle"}
                  >
                    Reinforce
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Workshop */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Workshop</h3>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
            onClick={() => handleWorkshopCraft("valor_charm")}
          >
            Craft Valor Charm
          </button>
          <button
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
            onClick={() => handleWorkshopCraft("scouting_cloak")}
          >
            Craft Scouting Cloak
          </button>
          <button
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", cursor: "pointer" }}
            onClick={() => handleWorkshopCraft("arcane_focus")}
          >
            Craft Arcane Focus
          </button>
        </div>

        {me.workshopJobs.length === 0 ? (
          <p style={{ opacity: 0.85 }}>No workshop jobs.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {me.workshopJobs.map((job) => (
              <div
                key={job.id}
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
                    <strong>{job.attachmentKind}</strong>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    {job.completed ? "Completed" : `Finishes ${new Date(job.finishesAt).toLocaleString()}`}
                  </div>
                </div>
                <button
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #777",
                    background: "#111",
                    cursor: "pointer",
                    opacity: job.completed ? 0.6 : 1,
                  }}
                  onClick={() => !job.completed && handleWorkshopCollect(job.id)}
                  disabled={job.completed}
                >
                  Collect
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Research */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Research</h3>

        {me.activeResearch ? (
          <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
            <div>
              <strong>{me.activeResearch.name}</strong> ({me.activeResearch.category})
            </div>
            <div style={{ opacity: 0.85 }}>{me.activeResearch.description}</div>
            <div>
              Progress: {me.activeResearch.progress} / {me.activeResearch.cost}
            </div>
          </div>
        ) : (
          <p style={{ opacity: 0.85 }}>No active research.</p>
        )}

        <strong>Available Tech</strong>
        {me.availableTechs.length === 0 ? (
          <p style={{ opacity: 0.85 }}>No tech available.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {me.availableTechs.map((t) => (
              <div key={t.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
                <div>
                  <strong>{t.name}</strong> ({t.category}) — Cost {t.cost}
                </div>
                <div style={{ opacity: 0.85 }}>{t.description}</div>
                <button
                  style={{
                    marginTop: 6,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #777",
                    background: "#111",
                    cursor: me.activeResearch ? "default" : "pointer",
                    opacity: me.activeResearch ? 0.6 : 1,
                  }}
                  onClick={() => !me.activeResearch && handleStartTech(t.id)}
                  disabled={!!me.activeResearch}
                >
                  Start Research
                </button>
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
          gap: 10,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Policies</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {(Object.keys(me.policies) as (keyof MeProfile["policies"])[]).map((key) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={me.policies[key]} onChange={() => handleTogglePolicy(key)} />
              <span>{key}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Events */}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Events</h3>
        {me.events.length === 0 ? (
          <p style={{ opacity: 0.85 }}>No events.</p>
        ) : (
          <div style={{ display: "grid", gap: 8, maxHeight: 320, overflowY: "auto" }}>
            {me.events.map((evt) => (
              <div key={evt.id} style={{ borderBottom: "1px solid #333", paddingBottom: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {new Date(evt.timestamp).toLocaleString()} · {evt.kind}
                </div>
                <div>{evt.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
