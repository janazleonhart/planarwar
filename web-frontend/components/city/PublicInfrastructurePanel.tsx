//web-frontend/components/city/PublicInfrastructurePanel.tsx

import type { CSSProperties } from "react";
import type {
  InfrastructureMode,
  MeProfile,
  PublicInfrastructureStatusResponse,
  Resources,
} from "../../lib/api";
import { PublicInfrastructureQuotesSection } from "./PublicInfrastructureQuotesSection";
import { PublicInfrastructureReceiptsSection } from "./PublicInfrastructureReceiptsSection";

type PublicInfrastructurePanelProps = {
  cardStyle: (extra?: CSSProperties) => CSSProperties;
  disabled: boolean;
  serviceMode: InfrastructureMode;
  setServiceMode: (mode: InfrastructureMode) => void;
  infraStatus: PublicInfrastructureStatusResponse | null;
  receipts: NonNullable<MeProfile["publicInfrastructure"]>["receipts"];
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  formatServiceLabel: (service: string) => string;
};

export function PublicInfrastructurePanel({
  cardStyle,
  disabled,
  serviceMode,
  setServiceMode,
  infraStatus,
  receipts,
  formatLevy,
  formatServiceLabel,
}: PublicInfrastructurePanelProps) {
  const infraSummary = infraStatus?.summary ?? null;

  return (
    <div style={cardStyle()}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>Public Infrastructure</h3>
          <div style={{ opacity: 0.8, fontSize: 13 }}>Choose whether eligible actions use private city lanes or NPC public service lanes.</div>
        </div>
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
      </div>

      {infraSummary ? (
        <>
          <div>
            <strong>Permit tier:</strong> {infraSummary.permitTier} • <strong>Strain band:</strong> {infraSummary.strainBand} • <strong>Recommended:</strong> {infraSummary.recommendedMode}
          </div>
          <div>
            <strong>Heat:</strong> {infraSummary.serviceHeat} • <strong>Queue pressure:</strong> {infraSummary.queuePressure} • <strong>Stress:</strong> {infraSummary.cityStressStage} ({infraSummary.cityStressTotal})
          </div>
          <div>
            <strong>Novice subsidy remaining:</strong> {infraSummary.subsidyCreditsRemaining}
          </div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>{infraSummary.note}</div>
        </>
      ) : (
        <div style={{ opacity: 0.7 }}>No public infrastructure profile yet.</div>
      )}

      <PublicInfrastructureQuotesSection
        serviceMode={serviceMode}
        infraStatus={infraStatus}
        formatLevy={formatLevy}
        formatServiceLabel={formatServiceLabel}
      />

      <PublicInfrastructureReceiptsSection
        receipts={receipts}
        formatLevy={formatLevy}
        formatServiceLabel={formatServiceLabel}
      />
    </div>
  );
}
