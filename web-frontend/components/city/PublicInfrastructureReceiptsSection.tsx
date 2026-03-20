//web-frontend/components/city/PublicInfrastructureReceiptsSection.tsx

import type { MeProfile, Resources } from "../../lib/api";
import { getInfrastructureReceiptTone, summarizePublicInfrastructureReceipts } from "./cityPolishSummaries";

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
  const orderedReceipts = receipts.slice().reverse();
  const summary = summarizePublicInfrastructureReceipts(orderedReceipts);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <strong>Recent public receipts</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          Permit decisions, service mode choices, and the civic bill that followed them back to your desk.
        </div>
      </div>

      {orderedReceipts.length === 0 ? (
        <div style={{ border: "1px dashed #666", borderRadius: 8, padding: "10px 12px", fontSize: 13, opacity: 0.76 }}>
          No public service receipts are logged yet. Once permit and service choices start landing, the paper trail will show up here instead of hiding the cost in the floorboards.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <div style={{ border: "1px solid #355d45", background: "rgba(30,70,40,0.16)", borderRadius: 8, padding: 10, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Receipts logged</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{orderedReceipts.length}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>Recent public service changes on file</div>
            </div>
            <div style={{ border: `1px solid ${summary.highestStrain >= 8 ? "#7a3d3d" : summary.highestStrain >= 5 ? "#77603a" : "#355d45"}`, background: summary.highestStrain >= 8 ? "rgba(100,30,30,0.16)" : summary.highestStrain >= 5 ? "rgba(90,70,30,0.16)" : "rgba(30,70,40,0.16)", borderRadius: 8, padding: 10, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Highest recorded strain</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{summary.highestStrain}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>Useful for spotting which service lane started pushing back first.</div>
            </div>
            <div style={{ border: `1px solid ${summary.queueAverage >= 30 ? "#77603a" : "#355d45"}`, background: summary.queueAverage >= 30 ? "rgba(90,70,30,0.16)" : "rgba(30,70,40,0.16)", borderRadius: 8, padding: 10, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Average queue</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{summary.queueAverage}m</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>
                Latest lane: {summary.latest ? formatServiceLabel(summary.latest.service) : "none"}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {orderedReceipts.map((receipt) => {
              const tone = getInfrastructureReceiptTone(receipt.strainScore);
              const strainTone = tone === "danger" ? "#7a3d3d" : tone === "watch" ? "#77603a" : "#355d45";
              const background = tone === "danger" ? "rgba(100,30,30,0.16)" : tone === "watch" ? "rgba(90,70,30,0.16)" : "rgba(30,70,40,0.16)";

              return (
                <div key={receipt.id} style={{ border: `1px solid ${strainTone}`, borderRadius: 8, padding: 10, display: "grid", gap: 6, background }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <strong>{formatServiceLabel(receipt.service)}</strong>
                    <span style={{ border: `1px solid ${strainTone}`, borderRadius: 999, padding: "2px 8px", fontSize: 12 }}>
                      {receipt.mode}
                    </span>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.82 }}>
                      queue +{receipt.queueMinutes}m
                    </span>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.82 }}>
                      strain {receipt.strainScore}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.84 }}>
                    {new Date(receipt.createdAt).toLocaleString()} • levy {formatLevy(receipt.levy)}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>{receipt.note}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
