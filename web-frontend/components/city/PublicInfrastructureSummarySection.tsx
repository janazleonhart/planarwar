//web-frontend/components/city/PublicInfrastructureSummarySection.tsx

import type { PublicInfrastructureStatusResponse } from "../../lib/api";

type PublicInfrastructureSummarySectionProps = {
  infraStatus: PublicInfrastructureStatusResponse | null;
};

export function PublicInfrastructureSummarySection({
  infraStatus,
}: PublicInfrastructureSummarySectionProps) {
  const infraSummary = infraStatus?.summary ?? null;

  if (!infraSummary) {
    return <div style={{ opacity: 0.7 }}>No public infrastructure profile yet.</div>;
  }

  return (
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
  );
}
