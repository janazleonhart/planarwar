//web-frontend/components/city/CityPolicyArmiesPanel.tsx

import type { CSSProperties } from "react";
import type { ArmyType, MeProfile } from "../../lib/api";

type CityPolicyArmiesPanelProps = {
  cardStyle: (extra?: CSSProperties) => CSSProperties;
  me: MeProfile;
  disabled: boolean;
  handleTogglePolicy: (key: keyof MeProfile["policies"]) => void | Promise<void> | undefined;
  handleRaiseArmy: (type: ArmyType) => void | Promise<void>;
  handleReinforceArmy: (armyId: string) => void | Promise<void>;
};

export function CityPolicyArmiesPanel({
  cardStyle,
  me,
  disabled,
  handleTogglePolicy,
  handleRaiseArmy,
  handleReinforceArmy,
}: CityPolicyArmiesPanelProps) {
  return (
    <div style={cardStyle()}>
      <h3 style={{ marginTop: 0 }}>Policies & Armies</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(Object.keys(me.policies) as Array<keyof MeProfile["policies"]>).map((key) => (
          <button
            key={key}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
            disabled={disabled}
            onClick={() => {
              const action = handleTogglePolicy(key);
              if (action) void action;
            }}
          >
            {key}: {String(me.policies[key])}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["militia", "line", "vanguard"] as const).map((type) => (
          <button
            key={type}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
            disabled={disabled}
            onClick={() => void handleRaiseArmy(type)}
          >
            Raise {type}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {me.armies.map((army) => (
          <div key={army.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div><strong>{army.name}</strong> ({army.type}) • power {army.power} • size {army.size} • {army.status}</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Readiness {army.readiness ?? 0}/100 • upkeep {army.upkeep?.wealth ?? 0} wealth + {army.upkeep?.materials ?? 0} materials/tick</div>
              <div style={{ fontSize: 12, opacity: 0.74 }}>Specialties: {(army.specialties ?? []).join(", ") || "general service"}</div>
            </div>
            <button
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #777", background: "#111", opacity: disabled ? 0.6 : 1 }}
              disabled={disabled}
              onClick={() => void handleReinforceArmy(army.id)}
            >
              Reinforce
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
