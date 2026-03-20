//web-frontend/components/worldResponse/worldResponsePolishSummaries.ts

import type { MissionDefenseReceipt } from "../../lib/apiTypes";
import type { SummaryTone } from "../city/cityPolishSummaries";

export function getMissionDefenseReceiptTone(receipt: MissionDefenseReceipt): SummaryTone {
  if (receipt.outcome === "failure") return "danger";
  if (receipt.setbacks.length > 0) return "watch";
  return "calm";
}

export function formatMissionDefenseOutcomeLabel(outcome: MissionDefenseReceipt["outcome"]): string {
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

export function summarizeMissionDefenseReceipts(receipts: MissionDefenseReceipt[]): {
  failedCount: number;
  setbackCount: number;
  latestPosture: string;
} {
  return {
    failedCount: receipts.filter((receipt) => receipt.outcome === "failure").length,
    setbackCount: receipts.reduce((sum, receipt) => sum + receipt.setbacks.length, 0),
    latestPosture: receipts[0]?.posture ?? "balanced",
  };
}
