//web-frontend/components/city/CityMudBridgeHooksSection.tsx

import type { CityMudBridgeStatusResponse } from "../../lib/api";

type CityMudBridgeHooksSectionProps = {
  hooks: NonNullable<CityMudBridgeStatusResponse["summary"]>["hooks"];
};

export function CityMudBridgeHooksSection({ hooks }: CityMudBridgeHooksSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>Bridge hooks for future world/MUD consumers</strong>
      <div style={{ display: "grid", gap: 6 }}>
        {hooks.map((hook) => (
          <div key={hook.key} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
            <div>
              <strong>{hook.label}</strong> • score {hook.score} • direction {hook.direction}
            </div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{hook.detail}</div>
            <div style={{ fontSize: 12, opacity: 0.72 }}>MUD effect: {hook.mudEffect}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
