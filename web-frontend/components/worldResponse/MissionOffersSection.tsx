//web-frontend/components/worldResponse/MissionOffersSection.tsx

import type { CSSProperties } from "react";
import type {
  MeProfile,
  MissionOffer,
  MissionResponsePosture,
} from "../../lib/api";
import {
  formatContractKind,
  formatWorldActionCost,
  getRegionDisplayName,
  getThreatFamilyDisplayName,
} from "./worldResponseUi";

type MissionOffersSectionProps = {
  me: MeProfile;
  missionOffers: MissionOffer[];
  disabled: boolean;
  missionHeroSelection: Record<string, string>;
  missionArmySelection: Record<string, string>;
  missionPostureSelection: Record<string, MissionResponsePosture>;
  setMissionHeroSelection: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setMissionArmySelection: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setMissionPostureSelection: React.Dispatch<React.SetStateAction<Record<string, MissionResponsePosture>>>;
  handleStartMission: (
    missionId: string,
    heroId?: string,
    armyId?: string,
    responsePosture?: MissionResponsePosture
  ) => void | Promise<void>;
};

type Tone = "calm" | "watch" | "danger";

const toneStyles: Record<Tone, CSSProperties> = {
  calm: { borderColor: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { borderColor: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { borderColor: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

function getMissionTone(mission: MissionOffer): Tone {
  if (mission.difficulty === "extreme" || mission.risk.casualtyRisk === "high") return "danger";
  if (mission.difficulty === "high" || mission.difficulty === "medium" || mission.risk.casualtyRisk === "medium") {
    return "watch";
  }
  return "calm";
}

function formatDifficultyLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function MissionOffersSection({
  me,
  missionOffers,
  disabled,
  missionHeroSelection,
  missionArmySelection,
  missionPostureSelection,
  setMissionHeroSelection,
  setMissionArmySelection,
  setMissionPostureSelection,
  handleStartMission,
}: MissionOffersSectionProps) {
  const heroOffers = missionOffers.filter((mission) => mission.kind === "hero").length;
  const armyOffers = missionOffers.length - heroOffers;
  const highRiskOffers = missionOffers.filter((mission) => getMissionTone(mission) === "danger").length;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong>Available offers</strong>
      <div style={{ fontSize: 12, opacity: 0.76 }}>
        Contracts and field problems that are currently worth answering. This board is meant to tell you what the city can tackle, how ugly it looks, and which desk should take the job.
      </div>
      {missionOffers.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No mission offers available right now.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <div style={{ border: "1px solid #355d45", background: "rgba(30,70,40,0.16)", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Offers on board</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{missionOffers.length}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>{heroOffers} hero • {armyOffers} army</div>
            </div>
            <div style={{ border: `1px solid ${highRiskOffers > 0 ? "#7a3d3d" : "#77603a"}`, background: highRiskOffers > 0 ? "rgba(100,30,30,0.16)" : "rgba(90,70,30,0.16)", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>High-risk offers</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{highRiskOffers}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>danger-level commitments</div>
            </div>
            <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Idle response pool</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{me.heroes.filter((hero) => hero.status === "idle").length + me.armies.filter((army) => army.status === "idle").length}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>{me.heroes.filter((hero) => hero.status === "idle").length} heroes • {me.armies.filter((army) => army.status === "idle").length} armies ready</div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {missionOffers.map((mission) => {
              const tone = getMissionTone(mission);
              const toneStyle = toneStyles[tone];
              return (
                <div
                  key={mission.id}
                  style={{
                    border: `1px solid ${typeof toneStyle.borderColor === "string" ? toneStyle.borderColor : "#555"}`,
                    background: typeof toneStyle.background === "string" ? toneStyle.background : undefined,
                    borderRadius: 8,
                    padding: 10,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <strong>{mission.title}</strong>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.9 }}>
                      {mission.kind === "hero" ? "Hero desk" : "Army desk"}
                    </span>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.9 }}>
                      {formatDifficultyLabel(mission.difficulty)}
                    </span>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.9 }}>
                      {getRegionDisplayName(mission.regionId)}
                    </span>
                  </div>
                  {mission.contractKind ? (
                    <div style={{ fontSize: 12, opacity: 0.86 }}>
                      Recovery contract: {formatContractKind(mission.contractKind)} • burden {mission.contractRecoveryBurdenDelta ?? 0} • trust {mission.contractTrustDelta ?? 0} • pressure {mission.contractPressureDelta ?? 0}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    Threat family: {getThreatFamilyDisplayName(mission.threatFamily)}{mission.targetingPressure != null ? ` • pressure ${mission.targetingPressure}` : ""}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.86 }}>{mission.description}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, opacity: 0.82 }}>
                    <span>Recommended power {mission.recommendedPower}</span>
                    <span>Rewards {formatWorldActionCost(mission.expectedRewards)}</span>
                    <span>Casualty risk {mission.risk.casualtyRisk}</span>
                    {mission.risk.heroInjuryRisk ? <span>Hero injury {mission.risk.heroInjuryRisk}</span> : null}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.78 }}>
                    Best response lanes: {mission.responseTags?.join(", ") || "generalist"}
                  </div>
                  {mission.targetingReasons?.length ? (
                    <div style={{ fontSize: 12, opacity: 0.76 }}>Why this city: {(mission.targetingReasons ?? []).join(" ")}</div>
                  ) : null}
                  {mission.supportGuidance ? (
                    <div style={{ fontSize: 12, opacity: 0.78 }}>
                      <strong>Support desk:</strong> {mission.supportGuidance.state} • {mission.supportGuidance.headline}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12, opacity: 0.74 }}>
                    {tone === "danger"
                      ? "This is an ugly commitment. Treat it like a serious field decision, not a casual dispatch."
                      : tone === "watch"
                        ? "This is viable, but not free. Expect some operational friction if you take it now."
                        : "This offer is comparatively clean and should be manageable with the right responder."}
                  </div>
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
                        onChange={(e) => setMissionPostureSelection((prev) => ({ ...prev, [mission.id]: e.target.value as MissionResponsePosture }))}
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
                        Dispatch hero
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
                        onChange={(e) => setMissionPostureSelection((prev) => ({ ...prev, [mission.id]: e.target.value as MissionResponsePosture }))}
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
                        Dispatch army
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
