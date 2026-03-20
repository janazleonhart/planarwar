//web-frontend/components/city/CityArmiesSection.tsx

import type { CSSProperties } from "react";
import type { Army, ArmyType, MeProfile } from "../../lib/api";

type CityArmiesSectionProps = {
  armies: MeProfile["armies"];
  disabled: boolean;
  handleRaiseArmy: (type: ArmyType) => void | Promise<void>;
  handleReinforceArmy: (armyId: string) => void | Promise<void>;
};

type Tone = "calm" | "watch" | "danger";

type ArmyRaiseOption = {
  type: ArmyType;
  label: string;
  hint: string;
};

const buttonStyle = (disabled: boolean): CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #777",
  background: "#111",
  opacity: disabled ? 0.6 : 1,
  cursor: disabled ? "not-allowed" : "pointer",
});

const toneStyles: Record<Tone, CSSProperties> = {
  calm: { borderColor: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { borderColor: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { borderColor: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

const raiseOptions: ArmyRaiseOption[] = [
  {
    type: "militia",
    label: "Militia levy",
    hint: "Cheap local bodies for immediate coverage and blunt-force readiness.",
  },
  {
    type: "line",
    label: "Line regiment",
    hint: "Balanced standing troops for routine defense and field pressure.",
  },
  {
    type: "vanguard",
    label: "Vanguard spearhead",
    hint: "Sharper response force for harder deployments and elite pressure points.",
  },
];

function getArmyTone(army: Army): Tone {
  if ((army.readiness ?? 0) < 40 || army.status === "on_mission") return "danger";
  if ((army.readiness ?? 0) < 70 || army.size < 40) return "watch";
  return "calm";
}

function summarizeArmyReadiness(armies: MeProfile["armies"]): string {
  if (!armies.length) return "No standing armies yet. The city has doctrine on paper, but no formations behind it.";
  const average = Math.round(armies.reduce((sum, army) => sum + (army.readiness ?? 0), 0) / armies.length);
  const deployed = armies.filter((army) => army.status === "on_mission").length;
  const ready = armies.filter((army) => (army.readiness ?? 0) >= 70 && army.status === "idle").length;
  return `${ready} ready for immediate response • ${deployed} currently deployed • average readiness ${average}/100`;
}

function formatArmyStatus(status: Army["status"]): string {
  return status === "on_mission" ? "Deployed" : "Idle";
}

export function CityArmiesSection({
  armies,
  disabled,
  handleRaiseArmy,
  handleReinforceArmy,
}: CityArmiesSectionProps) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <strong>Army desk</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          Raise forces, check which formations are actually ready, and decide whether this city has a credible answer when pressure lands.
        </div>
        <div style={{ fontSize: 12, opacity: 0.72 }}>{summarizeArmyReadiness(armies)}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
        {raiseOptions.map((option) => (
          <div key={option.type} style={{ border: "1px solid #555", borderRadius: 10, padding: 10, display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gap: 3 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>{option.type}</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{option.label}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>{option.hint}</div>
            </div>
            <button
              style={buttonStyle(disabled)}
              disabled={disabled}
              onClick={() => void handleRaiseArmy(option.type)}
            >
              Raise formation
            </button>
          </div>
        ))}
      </div>

      {!armies.length ? (
        <div style={{ border: "1px dashed #666", borderRadius: 10, padding: 12, fontSize: 13, opacity: 0.8 }}>
          No armies are mustered yet. The city can still posture, but until the first formation stands up this desk is measuring intent, not force.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {armies.map((army) => {
            const toneStyle = toneStyles[getArmyTone(army)];
            return (
              <div
                key={army.id}
                style={{
                  border: `1px solid ${typeof toneStyle.borderColor === "string" ? toneStyle.borderColor : "#555"}`,
                  background: typeof toneStyle.background === "string" ? toneStyle.background : undefined,
                  borderRadius: 10,
                  padding: 12,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "start" }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 12, opacity: 0.72 }}>{army.type}</div>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{army.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.78 }}>
                      {formatArmyStatus(army.status)} • power {army.power} • size {army.size}
                    </div>
                  </div>
                  <button
                    style={buttonStyle(disabled)}
                    disabled={disabled}
                    onClick={() => void handleReinforceArmy(army.id)}
                  >
                    Reinforce formation
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                  <div style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: 8, display: "grid", gap: 2 }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Readiness</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{army.readiness ?? 0}/100</div>
                    <div style={{ fontSize: 12, opacity: 0.72 }}>
                      {(army.readiness ?? 0) >= 70 ? "Fit for fast response." : (army.readiness ?? 0) >= 40 ? "Needs more drilling before hard deployments." : "Underprepared for serious pressure."}
                    </div>
                  </div>

                  <div style={{ border: "1px solid #4f4f4f", borderRadius: 8, padding: 8, display: "grid", gap: 2 }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Upkeep burden</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{army.upkeep?.wealth ?? 0}w / {army.upkeep?.materials ?? 0}m</div>
                    <div style={{ fontSize: 12, opacity: 0.72 }}>Paid each tick to keep this formation supplied, drilled, and worth fielding.</div>
                  </div>
                </div>

                <div style={{ fontSize: 12, opacity: 0.76 }}>
                  <strong>Specialties:</strong> {(army.specialties ?? []).join(", ") || "general service"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
