//web-frontend/components/city/PublicInfrastructureModeToggle.tsx

import type { InfrastructureMode } from "../../lib/api";

type PublicInfrastructureModeToggleProps = {
  disabled: boolean;
  serviceMode: InfrastructureMode;
  setServiceMode: (mode: InfrastructureMode) => void;
};

export function PublicInfrastructureModeToggle({
  disabled,
  serviceMode,
  setServiceMode,
}: PublicInfrastructureModeToggleProps) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        onClick={() => setServiceMode("private_city")}
        disabled={disabled}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: serviceMode === "private_city" ? "1px solid #7ad" : "1px solid #777",
          background: "#111",
          color: serviceMode === "private_city" ? "#bfe3ff" : "#eee",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        Private City
      </button>
      <button
        onClick={() => setServiceMode("npc_public")}
        disabled={disabled}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: serviceMode === "npc_public" ? "1px solid #d8a" : "1px solid #777",
          background: "#111",
          color: serviceMode === "npc_public" ? "#ffd3ea" : "#eee",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        NPC Public
      </button>
    </div>
  );
}
