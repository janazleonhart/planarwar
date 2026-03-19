//web-frontend/components/city/PublicInfrastructureReceiptsSection.tsx

import type { MeProfile, Resources } from "../../lib/api";

type PublicInfrastructureReceiptsSectionProps = {
  receipts: NonNullable<MeProfile["publicInfrastructure"]>["receipts"];
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  formatServiceLabel: (service: string) => string;
};

export function PublicInfrastructureReceiptsSection({
  receipts,
  formatLevy,
  formatServiceLabel,
}: PublicInfrastructureReceiptsSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>Recent public receipts</strong>
      {receipts.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No public service receipts yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {receipts.slice().reverse().map((receipt) => (
            <div key={receipt.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
              <div><strong>{formatServiceLabel(receipt.service)}</strong> • {receipt.mode} • {new Date(receipt.createdAt).toLocaleString()}</div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                Levy: {formatLevy(receipt.levy)} • Queue: +{receipt.queueMinutes}m • Strain: {receipt.strainScore}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{receipt.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
