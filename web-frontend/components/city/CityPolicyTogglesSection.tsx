//web-frontend/components/city/CityPolicyTogglesSection.tsx

import type { CSSProperties } from "react";
import type { MeProfile } from "../../lib/api";

type CityPolicyTogglesSectionProps = {
  policies: MeProfile["policies"];
  disabled: boolean;
  handleTogglePolicy: (key: keyof MeProfile["policies"]) => void | Promise<void> | undefined;
};

type PolicyTone = "calm" | "watch";

type PolicyDescriptor = {
  label: string;
  enabledHint: string;
  disabledHint: string;
  toneWhenEnabled: PolicyTone;
};

const buttonStyle = (disabled: boolean): CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #777",
  background: "#111",
  opacity: disabled ? 0.6 : 1,
  cursor: disabled ? "not-allowed" : "pointer",
});

const toneStyles: Record<PolicyTone, CSSProperties> = {
  calm: { borderColor: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { borderColor: "#77603a", background: "rgba(90,70,30,0.16)" },
};

const policyDescriptors: Record<keyof MeProfile["policies"], PolicyDescriptor> = {
  highTaxes: {
    label: "High taxes",
    enabledHint: "Treasury-first posture. Wealth rises faster, but civic patience thins.",
    disabledHint: "Softer levy posture. Less squeeze on the populace, less fast treasury gain.",
    toneWhenEnabled: "watch",
  },
  openTrade: {
    label: "Open trade",
    enabledHint: "Merchants and outside flow get a warmer reception.",
    disabledHint: "Trade stays tighter and more defensive.",
    toneWhenEnabled: "calm",
  },
  conscription: {
    label: "Conscription",
    enabledHint: "The city is leaning on the population to fill ranks quickly.",
    disabledHint: "Recruitment stays voluntary and slower.",
    toneWhenEnabled: "watch",
  },
  arcaneFreedom: {
    label: "Arcane freedom",
    enabledHint: "Mages and experimentation get more room to breathe.",
    disabledHint: "Arcane activity stays more tightly controlled.",
    toneWhenEnabled: "calm",
  },
};

function formatPolicyValue(value: boolean): string {
  return value ? "Enabled" : "Restricted";
}

export function CityPolicyTogglesSection({
  policies,
  disabled,
  handleTogglePolicy,
}: CityPolicyTogglesSectionProps) {
  const enabledCount = Object.values(policies).filter(Boolean).length;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <strong>Policy desk</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          These toggles set the city’s standing orders. They are less about clicking random doctrine buttons and more about deciding what kind of burden the city is willing to carry.
        </div>
        <div style={{ fontSize: 12, opacity: 0.72 }}>
          {enabledCount} of {Object.keys(policies).length} policy stances currently active.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}>
        {(Object.keys(policies) as Array<keyof MeProfile["policies"]>).map((key) => {
          const descriptor = policyDescriptors[key];
          const enabled = Boolean(policies[key]);
          const toneStyle = toneStyles[enabled ? descriptor.toneWhenEnabled : "calm"];
          return (
            <div
              key={key}
              style={{
                border: `1px solid ${typeof toneStyle.borderColor === "string" ? toneStyle.borderColor : "#555"}`,
                background: typeof toneStyle.background === "string" ? toneStyle.background : undefined,
                borderRadius: 10,
                padding: 10,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "grid", gap: 3 }}>
                <div style={{ fontSize: 12, opacity: 0.72 }}>{descriptor.label}</div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{formatPolicyValue(enabled)}</div>
                <div style={{ fontSize: 12, opacity: 0.78 }}>
                  {enabled ? descriptor.enabledHint : descriptor.disabledHint}
                </div>
              </div>
              <button
                style={buttonStyle(disabled)}
                disabled={disabled}
                onClick={() => {
                  const action = handleTogglePolicy(key);
                  if (action) void action;
                }}
              >
                {enabled ? "Relax policy" : "Adopt policy"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
