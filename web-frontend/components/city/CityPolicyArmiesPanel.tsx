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
      <h3 style={{ marginTop: 0 }}>Policies & Armies</h3>

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
