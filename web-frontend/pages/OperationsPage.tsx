// web-frontend/pages/OperationsPage.tsx

import { useEffect, useMemo, useState } from "react";
import {
  fetchMe,
  cityTierUp,
  cityMorph,
  fetchCityDebug,
  type MeProfile,
  type CitySummary,
  type Resources,
} from "../lib/api";

type MissionLike = {
  missionId?: string;
  title?: string;
  kind?: string;
  state?: string;
  startedAt?: string;
  etaSeconds?: number;
};

function fmtJson(v: any): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function OperationsPage() {
  const [me, setMe] = useState<MeProfile | null>(null);
  const [cityDebug, setCityDebug] = useState<{ city: CitySummary | null; resources: Resources | null } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [morphSpecId, setMorphSpecId] = useState("");
  const [lastResult, setLastResult] = useState<any>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMe();
      setMe(data);

      // Optional debug read (helps verify city endpoints are wired; safe to fail).
      try {
        const dbg = await fetchCityDebug();
        setCityDebug({
          city: (dbg as any)?.city ?? null,
          resources: (dbg as any)?.resources ?? null,
        });
      } catch {
        setCityDebug(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Failed to load /api/me");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const active: MissionLike[] = ((me as any)?.activeMissions ?? []) as MissionLike[];

  const city = me?.city ?? null;
  const resources = (me as any)?.resources ?? null;

  const cityName = city?.name ?? "City";
  const cityTier = city?.tier ?? null;
  const specLabel = city?.specializationId ? city.specializationId : "none";

  const cityDebugLabel = useMemo(() => {
    if (!cityDebug) return null;
    const tier = cityDebug.city?.tier;
    const shard = cityDebug.city?.shardId;
    const region = cityDebug.city?.regionId;
    return `${tier ?? "?"} • ${shard ?? "?"} • ${region ?? "?"}`;
  }, [cityDebug]);

  const doTierUp = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await cityTierUp();
      setLastResult(res);
      await refresh();
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Tier up failed");
    } finally {
      setBusy(false);
    }
  };

  const doMorph = async () => {
    const spec = morphSpecId.trim();
    if (!spec) {
      setError("specializationId is required for morph");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await cityMorph(spec);
      setLastResult(res);
      await refresh();
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Morph failed");
    } finally {
      setBusy(false);
    }
  };

  const clearResult = () => setLastResult(null);

  if (loading && !me) return <p>Loading CityBuilder operations…</p>;

  return (
    <section style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <h3 style={{ marginTop: 0 }}>Operations</h3>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #777",
              background: "#111",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #552", borderRadius: 8, background: "#221" }}>
          <strong style={{ color: "salmon" }}>Error:</strong>{" "}
          <span style={{ color: "salmon" }}>{error}</span>
        </div>
      ) : null}

      {/* City ops */}
      <div style={{ border: "1px solid #333", borderRadius: 10, padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <strong>{cityName}</strong>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
              Tier: {cityTier ?? "?"} • Spec: {specLabel}
              {cityDebugLabel ? <span style={{ opacity: 0.7 }}> • debug: {cityDebugLabel}</span> : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #777",
                background: "#111",
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
              disabled={busy}
              onClick={() => void doTierUp()}
              title="POST /api/city/tier-up"
            >
              Tier up
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 13, opacity: 0.85 }}>Morph specialization:</label>
          <input
            value={morphSpecId}
            onChange={(e) => setMorphSpecId(e.target.value)}
            placeholder="e.g. arcane, military, trade..."
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #555",
              background: "#0b0b0b",
              color: "#ddd",
              minWidth: 220,
            }}
            disabled={busy}
          />
          <button
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #777",
              background: "#111",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
            disabled={busy}
            onClick={() => void doMorph()}
            title="POST /api/city/morph"
          >
            Morph
          </button>
        </div>

        {resources ? (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>Food: {(resources as any).food ?? "?"}</span>
            <span>Materials: {(resources as any).materials ?? "?"}</span>
            <span>Wealth: {(resources as any).wealth ?? "?"}</span>
            <span>Mana: {(resources as any).mana ?? "?"}</span>
            <span>Knowledge: {(resources as any).knowledge ?? "?"}</span>
            <span>Unity: {(resources as any).unity ?? "?"}</span>
          </div>
        ) : null}

        {lastResult ? (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}>Last operation result</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 8 }}>{fmtJson(lastResult)}</pre>
            <button
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #777",
                background: "#111",
                cursor: "pointer",
              }}
              onClick={clearResult}
            >
              Clear result
            </button>
          </details>
        ) : null}
      </div>

      {/* Active missions */}
      {active.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No active missions.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {active.map((m, idx) => (
            <div
              key={`${m.missionId ?? "mission"}:${idx}`}
              style={{
                border: "1px solid #444",
                borderRadius: 8,
                padding: 12,
                display: "grid",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <strong>{m.title ?? m.missionId ?? "Mission"}</strong>
                <span style={{ opacity: 0.75 }}>{m.state ?? "unknown"}</span>
              </div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>
                Kind: {m.kind ?? "unknown"}{" "}
                {typeof m.etaSeconds === "number" ? `• ETA: ~${m.etaSeconds}s` : null}
              </div>
              {m.startedAt ? <div style={{ fontSize: 12, opacity: 0.7 }}>Started: {m.startedAt}</div> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
