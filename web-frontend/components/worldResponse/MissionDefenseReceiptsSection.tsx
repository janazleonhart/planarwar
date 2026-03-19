// web-frontend/components/worldResponse/MissionDefenseReceiptsSection.tsx

import type { MissionDefenseReceipt } from "../../lib/api";

type MissionDefenseReceiptsSectionProps = {
  highlightedReceipts: MissionDefenseReceipt[];
};

export function MissionDefenseReceiptsSection({ highlightedReceipts }: MissionDefenseReceiptsSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>Recent defense receipts</strong>
      {highlightedReceipts.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No defense receipts yet. Once missions resolve, setbacks and posture receipts show up here.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {highlightedReceipts.map((receipt) => (
            <div key={receipt.id} style={{ border: "1px solid #555", borderRadius: 8, padding: 10, display: "grid", gap: 5, background: "rgba(60,20,20,0.08)" }}>
              <div><strong>{receipt.missionTitle}</strong> • {receipt.outcome} • posture {receipt.posture}</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>{receipt.summary}</div>
              {receipt.setbacks.length ? (
                <div style={{ display: "grid", gap: 4 }}>
                  {receipt.setbacks.map((setback, idx) => (
                    <div key={`${receipt.id}_${idx}`} style={{ fontSize: 12, opacity: 0.8 }}>
                      • <strong>{setback.summary}</strong> — {setback.detail}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.76 }}>No major setbacks recorded.</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
