//web-frontend/components/city/CityPolicyTogglesSection.tsx

import type { CSSProperties } from "react";
import type { MeProfile } from "../../lib/api";

type CityPolicyTogglesSectionProps = {
  policies: MeProfile["policies"];
  disabled: boolean;
  handleTogglePolicy: (key: keyof MeProfile["policies"]) => void | Promise<void> | undefined;
};

const buttonStyle = (disabled: boolean): CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #777",
  background: "#111",
  opacity: disabled ? 0.6 : 1,
});

export function CityPolicyTogglesSection({
  policies,
  disabled,
  handleTogglePolicy,
}: CityPolicyTogglesSectionProps) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong>Policies</strong>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(Object.keys(policies) as Array<keyof MeProfile["policies"]>).map((key) => (
          <button
            key={key}
            style={buttonStyle(disabled)}
            disabled={disabled}
            onClick={() => {
              const action = handleTogglePolicy(key);
              if (action) void action;
            }}
          >
            {key}: {String(policies[key])}
          </button>
        ))}
      </div>
    </div>
  );
}
