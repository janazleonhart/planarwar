//web-frontend/components/city/CityPolicyArmiesPanel.tsx

import type { CSSProperties } from "react";
import type { ArmyType, MeProfile } from "../../lib/api";
import { CityArmiesSection } from "./CityArmiesSection";
import { CityPolicyTogglesSection } from "./CityPolicyTogglesSection";

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
      <div style={{ display: "grid", gap: 6 }}>
        <h3 style={{ margin: 0 }}>Policy & armies desk</h3>
        <div style={{ fontSize: 13, opacity: 0.78 }}>
          Standing orders and force readiness belong together here: one half decides what burdens the city accepts, the other decides whether anyone can enforce those decisions when the bill comes due.
        </div>
      </div>

      <CityPolicyTogglesSection
        policies={me.policies}
        disabled={disabled}
        handleTogglePolicy={handleTogglePolicy}
      />

      <CityArmiesSection
        armies={me.armies}
        disabled={disabled}
        handleRaiseArmy={handleRaiseArmy}
        handleReinforceArmy={handleReinforceArmy}
      />
    </div>
  );
}
