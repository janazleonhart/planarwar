//web-frontend/components/city/PublicInfrastructurePanel.tsx

import type { CSSProperties } from "react";
import type {
  InfrastructureMode,
  MeProfile,
  PublicInfrastructureStatusResponse,
  Resources,
} from "../../lib/api";
import { PublicInfrastructureModeToggle } from "./PublicInfrastructureModeToggle";
import { PublicInfrastructureQuotesSection } from "./PublicInfrastructureQuotesSection";
import { PublicInfrastructureReceiptsSection } from "./PublicInfrastructureReceiptsSection";
import { PublicInfrastructureSummarySection } from "./PublicInfrastructureSummarySection";

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
  return (
    <div style={cardStyle()}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h3 style={{ margin: 0 }}>Public Infrastructure</h3>
          <div style={{ opacity: 0.8, fontSize: 13 }}>
            Decide whether eligible work runs through your own civic lanes or the public desks, then read the cost, queue, and strain picture before you file the order.
          </div>
        </div>
        <PublicInfrastructureModeToggle
          disabled={disabled}
          serviceMode={serviceMode}
          setServiceMode={setServiceMode}
        />
      </div>

      <PublicInfrastructureSummarySection infraStatus={infraStatus} />

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
