// web-frontend/pages/OperationsPage.tsx

import { useEffect, useState } from "react";
import { fetchMe, type MeProfile } from "../lib/api";

type MissionLike = {
  missionId?: string;
  title?: string;
  kind?: string;
  state?: string;
  startedAt?: string;
  etaSeconds?: number;
};

export function OperationsPage() {
  const [me, setMe] = useState<MeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMe();
      setMe(data);
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

  const active: MissionLike[] = (me as any)?.activeMissions ?? [];

  if (loading && !me) return <p>Loading CityBuilder operations…</p>;

  if (error) {
    return (
      <section style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Operations</h3>
        <p style={{ color: "salmon" }}>{error}</p>
        <button
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #777",
            background: "#111",
            cursor: "pointer",
          }}
          onClick={() => void refresh()}
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ marginTop: 0 }}>Operations</h3>
        <button
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #777",
            background: "#111",
            cursor: "pointer",
          }}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

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
              {m.startedAt ? (
                <div style={{ fontSize: 12, opacity: 0.7 }}>Started: {m.startedAt}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
