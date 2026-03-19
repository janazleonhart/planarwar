// web-frontend/components/worldResponse/MissionDefenseReceiptsSection.tsx

import type { MissionDefenseReceipt } from "../../lib/api";

type MissionDefenseReceiptsSectionProps = {
  highlightedReceipts: MissionDefenseReceipt[];
};

type ReceiptTone = "calm" | "watch" | "danger";

const tonePalette: Record<ReceiptTone, { border: string; background: string }> = {
  calm: { border: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { border: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { border: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

function getReceiptTone(receipt: MissionDefenseReceipt): ReceiptTone {
  if (receipt.outcome === "failure") return "danger";
  if (receipt.setbacks.length > 0) return "watch";
  return "calm";
}

function formatOutcomeLabel(outcome: MissionDefenseReceipt["outcome"]): string {
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

export function MissionDefenseReceiptsSection({ highlightedReceipts }: MissionDefenseReceiptsSectionProps) {
  const failedCount = highlightedReceipts.filter((receipt) => receipt.outcome === "failure").length;
  const setbackCount = highlightedReceipts.reduce((sum, receipt) => sum + receipt.setbacks.length, 0);
  const latestPosture = highlightedReceipts[0]?.posture ?? "balanced";

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <strong>Recent defense receipts</strong>
        <div style={{ fontSize: 12, opacity: 0.76 }}>
          Recent mission outcomes, posture choices, and the bits that actually came back bleeding.
        </div>
      </div>

      {highlightedReceipts.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No defense receipts yet. Once missions resolve, setbacks and posture receipts show up here.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <div style={{ border: "1px solid #355d45", background: "rgba(30,70,40,0.16)", borderRadius: 8, padding: 10, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Receipts logged</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{highlightedReceipts.length}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>Latest operational outcomes on file</div>
            </div>
            <div style={{ border: `1px solid ${failedCount > 0 ? "#7a3d3d" : "#355d45"}`, background: failedCount > 0 ? "rgba(100,30,30,0.16)" : "rgba(30,70,40,0.16)", borderRadius: 8, padding: 10, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Failed operations</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{failedCount}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>{failedCount > 0 ? "These are the ones still asking awkward questions." : "Nothing has outright cratered."}</div>
            </div>
            <div style={{ border: `1px solid ${setbackCount > 0 ? "#77603a" : "#355d45"}`, background: setbackCount > 0 ? "rgba(90,70,30,0.16)" : "rgba(30,70,40,0.16)", borderRadius: 8, padding: 10, display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Recorded setbacks</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{setbackCount}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>Latest posture: {latestPosture}</div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {highlightedReceipts.map((receipt) => {
              const tone = getReceiptTone(receipt);
              const palette = tonePalette[tone];
              return (
                <div
                  key={receipt.id}
                  style={{
                    border: `1px solid ${palette.border}`,
                    borderRadius: 8,
                    padding: 10,
                    display: "grid",
                    gap: 6,
                    background: palette.background,
                  }}
                >
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <strong>{receipt.missionTitle}</strong>
                    <span style={{ border: `1px solid ${palette.border}`, borderRadius: 999, padding: "2px 8px", fontSize: 12 }}>
                      {formatOutcomeLabel(receipt.outcome)}
                    </span>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.84 }}>
                      posture {receipt.posture}
                    </span>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.78 }}>
                      {receipt.setbacks.length} setback{receipt.setbacks.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.84 }}>{receipt.summary}</div>

                  {receipt.setbacks.length ? (
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.68 }}>Setback ledger</div>
                      {receipt.setbacks.map((setback, idx) => (
                        <div key={`${receipt.id}_${idx}`} style={{ fontSize: 12, opacity: 0.82 }}>
                          • <strong>{setback.summary}</strong> — {setback.detail}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, opacity: 0.76 }}>No major setbacks recorded.</div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
