// web-frontend/pages/OperationsPage.tsx

import { useEffect, useState } from "react";
import { fetchMe } from "../lib/api";

import type { MeProfile } from "../lib/api";

// Legacy (pre-MeProfile-v2) mission payload shape.
// We keep this ONLY for optional display if the backend still returns it for CityBuilder.
type LegacyActiveMission = {
  instanceId: string;
  finishesAt: string;
  mission: {
    title: string;
    kind: string;
    difficulty: string;
    regionId: string;
  };
};

function getLegacyActiveMissions(me: MeProfile): LegacyActiveMission[] {
  const legacy = (me as unknown as { activeMissions?: unknown }).activeMissions;
  return Array.isArray(legacy) ? (legacy as LegacyActiveMission[]) : [];
}

export function OperationsPage() {
  const [me, setMe] = useState<MeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchMe();
        setMe(data);
      } catch (err) {
        console.error(err);
        setError("Failed to load operations data from backend.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p>Loading operations…</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!me) return <p>No data loaded.</p>;

  const active = getLegacyActiveMissions(me);

  return (
    <section style={{ maxWidth: 900, margin: "0 auto", display: "grid", gap: 24 }}>
      <h2>Operations</h2>

      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 8,
        }}
      >
        <p style={{ margin: 0, opacity: 0.8, fontSize: 14 }}>
          This is an early read-only view of your current operations.
          Mission start/complete actions are wired on the <code>/me</code> page for now.
        </p>

        <div style={{ fontSize: 13, opacity: 0.85, display: "grid", gap: 2 }}>
          <div>
            <strong>User:</strong> {me.username}{" "}
            <span style={{ opacity: 0.7 }}>({me.userId})</span>
          </div>
          <div>
            <strong>City:</strong>{" "}
            {me.city ? `${me.city.name} (Tier ${me.city.tier})` : "None"}
          </div>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Active Missions (legacy)</h3>

        {active.length === 0 ? (
          <p style={{ margin: 0, opacity: 0.85 }}>
            No mission data available in the current <code>/api/me</code> payload.
            (This section only renders if the backend sends legacy mission fields.)
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
              fontSize: 14,
            }}
          >
            {active.map((am) => {
              const finishTime = new Date(am.finishesAt);
              const now = new Date();
              const isComplete = now.getTime() >= finishTime.getTime();

              return (
                <div
                  key={am.instanceId}
                  style={{
                    border: "1px solid #555",
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <strong>{am.mission.title}</strong>
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <strong>Type:</strong> {am.mission.kind.toUpperCase()} –{" "}
                    {am.mission.difficulty.toUpperCase()}
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <strong>Region:</strong> {am.mission.regionId}
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <strong>Finishes:</strong> {finishTime.toLocaleString()}
                  </div>
                  <div style={{ marginBottom: 0 }}>
                    <strong>Status:</strong>{" "}
                    {isComplete ? "Ready to complete (see /me)" : "In progress"}
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
