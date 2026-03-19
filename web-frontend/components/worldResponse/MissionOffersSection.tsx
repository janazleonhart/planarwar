//web-frontend/components/worldResponse/MissionOffersSection.tsx

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
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>Available offers</strong>
      {missionOffers.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No mission offers available right now.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {missionOffers.map((mission) => (
            <div key={mission.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5 }}>
              <div><strong>{mission.title}</strong> • {mission.kind} • {mission.difficulty} • {getRegionDisplayName(mission.regionId)}</div>
              {mission.contractKind ? (
                <div style={{ fontSize: 12, opacity: 0.86 }}>Recovery contract: {formatContractKind(mission.contractKind)} • burden {mission.contractRecoveryBurdenDelta ?? 0} • trust {mission.contractTrustDelta ?? 0} • pressure {mission.contractPressureDelta ?? 0}</div>
              ) : null}
              <div style={{ fontSize: 12, opacity: 0.8 }}>Threat family: {getThreatFamilyDisplayName(mission.threatFamily)}{mission.targetingPressure != null ? ` • pressure ${mission.targetingPressure}` : ""}</div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>{mission.description}</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Recommended power {mission.recommendedPower} • rewards {formatWorldActionCost(mission.expectedRewards)}</div>
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
                    Start mission
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
