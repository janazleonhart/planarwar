//web-frontend/components/city/PublicInfrastructureModeToggle.tsx

import type { CSSProperties } from "react";
import type { InfrastructureMode } from "../../lib/api";

type PublicInfrastructureModeToggleProps = {
  disabled: boolean;
  serviceMode: InfrastructureMode;
  setServiceMode: (mode: InfrastructureMode) => void;
};

const buttonStyle = (active: boolean, disabled: boolean, accent: string, glow: string): CSSProperties => ({
  padding: "8px 12px",
  borderRadius: 8,
  border: active ? `1px solid ${accent}` : "1px solid #666",
  background: active ? glow : "#111",
  color: active ? "#fff" : "#eee",
  opacity: disabled ? 0.6 : 1,
  display: "grid",
  gap: 2,
  minWidth: 170,
  textAlign: "left",
});

export function PublicInfrastructureModeToggle({
  disabled,
  serviceMode,
  setServiceMode,
}: PublicInfrastructureModeToggleProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, opacity: 0.74 }}>Routing stance</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => setServiceMode("private_city")}
          disabled={disabled}
          style={buttonStyle(serviceMode === "private_city", disabled, "#7ad", "rgba(80,120,180,0.18)")}
        >
          <strong>Private city lanes</strong>
          <span style={{ fontSize: 12, opacity: 0.78 }}>Keep the work in-house when your own desks can carry it cleanly.</span>
        </button>
        <button
          onClick={() => setServiceMode("npc_public")}
          disabled={disabled}
          style={buttonStyle(serviceMode === "npc_public", disabled, "#d8a", "rgba(150,80,120,0.18)")}
        >
          <strong>Public service desks</strong>
          <span style={{ fontSize: 12, opacity: 0.78 }}>Push the order to outside civic lanes when you would rather buy time than spend local capacity.</span>
        </button>
      </div>
    </div>
  );
}
