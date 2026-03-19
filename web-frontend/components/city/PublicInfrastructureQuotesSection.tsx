//web-frontend/components/city/PublicInfrastructureQuotesSection.tsx

import type { PublicInfrastructureStatusResponse, PublicServiceQuote, Resources } from "../../lib/api";

type PublicInfrastructureQuotesSectionProps = {
  serviceMode: string;
  infraStatus: PublicInfrastructureStatusResponse | null;
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  formatServiceLabel: (service: string) => string;
};

export function PublicInfrastructureQuotesSection({
  serviceMode,
  infraStatus,
  formatLevy,
  formatServiceLabel,
}: PublicInfrastructureQuotesSectionProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>Projected service quotes ({serviceMode})</strong>
      {(infraStatus?.quotes ?? []).length === 0 ? (
        <div style={{ opacity: 0.7 }}>No quote data.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {(infraStatus?.quotes ?? []).map((quote: PublicServiceQuote) => (
            <div key={quote.service} style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
              <div><strong>{formatServiceLabel(quote.service)}</strong></div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                Levy: {formatLevy(quote.levy)} • Queue: +{quote.queueMinutes}m • Strain: {quote.strainScore}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{quote.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
