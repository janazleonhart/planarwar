//web-frontend/components/worldResponse/CityAlphaPanels.tsx

import type {
  CityAlphaScopeLockBucket,
  CityAlphaScopeLockSummary,
  CityAlphaStatusSummary,
  EconomyCartelResponseState,
} from "../../lib/api";
import {
  cityAlphaScopeBucketColor,
  cityAlphaScopeBucketLabel,
  cityAlphaSeverityColor,
  cityAlphaSeverityLabel,
  formatResponseLaneList,
  formatWhenShort,
  worldSeverityColor,
} from "./worldResponseUi";

type CityAlphaPanelsProps = {
  cityAlphaStatus: CityAlphaStatusSummary | null;
  cityAlphaScopeLock: CityAlphaScopeLockSummary | null;
  economyCartelResponseState: EconomyCartelResponseState | null;
  highlightedPressureCount: number;
  getThreatFamilyDisplayName: (family?: string) => string;
};

const CITY_ALPHA_SCOPE_BUCKETS: Array<[
  CityAlphaScopeLockBucket,
  keyof Pick<CityAlphaScopeLockSummary, "alreadyExists" | "existsButWeak" | "missing" | "exclusions">
]> = [
  ["already_exists", "alreadyExists"],
  ["exists_but_weak", "existsButWeak"],
  ["missing", "missing"],
  ["excluded", "exclusions"],
];

function CityAlphaScopeLockResponseState({
  economyCartelResponseState,
}: {
  economyCartelResponseState: EconomyCartelResponseState | null;
}) {
  if (!economyCartelResponseState) return null;

  return (
    <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(56,36,18,0.16)" }}>
      <div><strong>{economyCartelResponseState.summary.headline}</strong></div>
      <div style={{ fontSize: 12, opacity: 0.82 }}>
        phase <strong style={{ color: worldSeverityColor(economyCartelResponseState.summary.responsePhase) }}>{economyCartelResponseState.summary.responsePhase}</strong>
        {" • "}runtime {economyCartelResponseState.summary.shouldNudgeRuntime ? "nudging" : "observe only"}
      </div>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        black market {economyCartelResponseState.blackMarket.state} / {economyCartelResponseState.blackMarket.posture}
        {" • "}cartel {economyCartelResponseState.cartel.tier} / {economyCartelResponseState.cartel.posture}
      </div>
      <div style={{ fontSize: 12, opacity: 0.76 }}>{economyCartelResponseState.blackMarket.note}</div>
      <div style={{ fontSize: 12, opacity: 0.76 }}>{economyCartelResponseState.cartel.note}</div>
    </div>
  );
}

export function CityAlphaPanels({
  cityAlphaStatus,
  cityAlphaScopeLock,
  economyCartelResponseState,
  highlightedPressureCount,
  getThreatFamilyDisplayName,
}: CityAlphaPanelsProps) {
  return (
    <>
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
              <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Pressure windows</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{cityAlphaStatus.urgentPressureCount} urgent • {highlightedPressureCount} surfaced</div></div>
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

            <CityAlphaScopeLockResponseState economyCartelResponseState={economyCartelResponseState} />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
              <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Already exists</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{(cityAlphaScopeLock.alreadyExists ?? []).length} locked</div></div>
              <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Exists but weak</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{(cityAlphaScopeLock.existsButWeak ?? []).length} follow-up targets</div></div>
              <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Missing</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{(cityAlphaScopeLock.missing ?? []).length} deferred beyond alpha</div></div>
              <div style={{ border: "1px solid #444", borderRadius: 8, padding: 8 }}><strong>Frozen exclusions</strong><div style={{ fontSize: 12, opacity: 0.84 }}>{(cityAlphaScopeLock.exclusions ?? []).length} explicitly out</div></div>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {CITY_ALPHA_SCOPE_BUCKETS.map(([bucket, key]) => {
                const items = cityAlphaScopeLock[key] ?? [];
                return (
                  <div key={bucket} style={{ display: "grid", gap: 6 }}>
                    <strong style={{ fontSize: 13 }}>{cityAlphaScopeBucketLabel(bucket)}</strong>
                    {items.length === 0 ? (
                      <div style={{ fontSize: 12, opacity: 0.68 }}>No items in this bucket.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 6 }}>
                        {items.map((item) => (
                          <div key={item.id} style={{ border: `1px solid ${cityAlphaScopeBucketColor(bucket)}`, borderRadius: 8, padding: 8, display: "grid", gap: 3 }}>
                            <div><strong>{item.label}</strong></div>
                            <div style={{ fontSize: 12, opacity: 0.82 }}>{item.detail}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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
    </>
  );
}
