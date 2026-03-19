//web-frontend/components/worldResponse/MissionBoardDigest.tsx

import type {
  ActiveMission,
  EconomyCartelResponseState,
  MeProfile,
  MissionDefenseReceipt,
  MissionOffer,
  MotherBrainPressureWindow,
  ThreatWarning,
} from "../../lib/api";

type MissionBoardDigestProps = {
  me: MeProfile;
  missionOffers: MissionOffer[];
  activeMissions: ActiveMission[];
  highlightedWarnings: ThreatWarning[];
  highlightedPressure: MotherBrainPressureWindow[];
  highlightedReceipts: MissionDefenseReceipt[];
  economyCartelResponseState: EconomyCartelResponseState | null;
};

type DigestTone = "calm" | "watch" | "danger";

type DigestItem = {
  label: string;
  value: string;
  hint: string;
  tone?: DigestTone;
};

const tonePalette: Record<DigestTone, { border: string; background: string }> = {
  calm: { border: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { border: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { border: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

function summarizeOperationalHeadline(
  warnings: ThreatWarning[],
  pressure: MotherBrainPressureWindow[],
  activeMissions: ActiveMission[],
  economyCartelResponseState: EconomyCartelResponseState | null
): { headline: string; detail: string } {
  const urgentPressure = pressure.filter((item) => item.confidence === "urgent").length;
  const cartelPhase = economyCartelResponseState?.summary.responsePhase ?? "quiet";

  if (urgentPressure > 0) {
    return {
      headline: `Immediate pressure window${urgentPressure > 1 ? "s" : ""} open`,
      detail: `Mother Brain is flagging ${urgentPressure} urgent pressure window${urgentPressure > 1 ? "s" : ""}. This is not the moment for pretty theory-crafting.`,
    };
  }

  if (warnings.length > 0) {
    return {
      headline: `Warning traffic is live`,
      detail: `${warnings.length} warning window${warnings.length > 1 ? "s" : ""} are on the board. Prep lanes matter more than optimism right now.`,
    };
  }

  if (activeMissions.length > 0) {
    return {
      headline: `Field operations already committed`,
      detail: `${activeMissions.length} mission${activeMissions.length > 1 ? "s are" : " is"} in motion. The board is in execution mode, not just planning mode.`,
    };
  }

  if (cartelPhase === "active" || cartelPhase === "severe") {
    return {
      headline: `Economic pressure is shaping the board`,
      detail: `The response phase is ${cartelPhase}. Even quiet mission screens are still being bent by that pressure story.`,
    };
  }

  return {
    headline: "Board is readable and stable",
    detail: "No urgent field alarms are shouting over the desk right now, so this is a good window to queue the next clean deployment.",
  };
}

export function MissionBoardDigest({
  me,
  missionOffers,
  activeMissions,
  highlightedWarnings,
  highlightedPressure,
  highlightedReceipts,
  economyCartelResponseState,
}: MissionBoardDigestProps) {
  const idleHeroes = me.heroes.filter((hero) => hero.status === "idle").length;
  const idleArmies = me.armies.filter((army) => army.status === "idle").length;
  const urgentPressure = highlightedPressure.filter((item) => item.confidence === "urgent").length;
  const failedReceipts = highlightedReceipts.filter((receipt) => receipt.outcome === "failure").length;
  const recentSetbacks = highlightedReceipts.reduce((sum, receipt) => sum + receipt.setbacks.length, 0);
  const missionSupportState = economyCartelResponseState?.missions.state ?? "none";
  const supportTone: DigestTone =
    missionSupportState === "restricted"
      ? "danger"
      : missionSupportState === "pressured"
        ? "watch"
        : "calm";

  const status = summarizeOperationalHeadline(
    highlightedWarnings,
    highlightedPressure,
    activeMissions,
    economyCartelResponseState
  );

  const digestItems: DigestItem[] = [
    {
      label: "Ready offers",
      value: String(missionOffers.length),
      hint: missionOffers.length > 0 ? "live choices on the board" : "no fresh contracts yet",
      tone: missionOffers.length > 0 ? "calm" : "watch",
    },
    {
      label: "Active deployments",
      value: String(activeMissions.length),
      hint: activeMissions.length > 0 ? "missions already committed" : "nothing deployed right now",
      tone: activeMissions.length > 0 ? "watch" : "calm",
    },
    {
      label: "Warning windows",
      value: String(highlightedWarnings.length),
      hint: urgentPressure > 0 ? `${urgentPressure} urgent pressure window${urgentPressure > 1 ? "s" : ""}` : "incoming threat intel",
      tone: highlightedWarnings.length > 0 || urgentPressure > 0 ? "danger" : "calm",
    },
    {
      label: "Ready responders",
      value: `${idleHeroes}H / ${idleArmies}A`,
      hint: "idle heroes / idle armies",
      tone: idleHeroes + idleArmies > 0 ? "calm" : "watch",
    },
    {
      label: "Support posture",
      value: missionSupportState === "none" ? "stable" : missionSupportState,
      hint: economyCartelResponseState?.missions.note ?? "mission logistics posture",
      tone: supportTone,
    },
    {
      label: "Recent fallout",
      value: failedReceipts > 0 ? `${failedReceipts} failed` : String(highlightedReceipts.length),
      hint:
        recentSetbacks > 0
          ? `${recentSetbacks} setback${recentSetbacks > 1 ? "s" : ""} recorded`
          : "no recent defense fallout logged",
      tone: failedReceipts > 0 || recentSetbacks > 0 ? "watch" : "calm",
    },
  ];

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          border: "1px solid #4d5666",
          borderRadius: 10,
          padding: 12,
          display: "grid",
          gap: 4,
          background: "rgba(70,90,120,0.10)",
        }}
      >
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.74 }}>
          Ruler&apos;s mission digest
        </div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{status.headline}</div>
        <div style={{ fontSize: 13, opacity: 0.84 }}>{status.detail}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        {digestItems.map((item) => {
          const tone = tonePalette[item.tone ?? "watch"];
          return (
            <div
              key={item.label}
              style={{
                border: `1px solid ${tone.border}`,
                borderRadius: 10,
                padding: 10,
                display: "grid",
                gap: 3,
                background: tone.background,
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.74 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{item.value}</div>
              <div style={{ fontSize: 12, opacity: 0.78 }}>{item.hint}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
