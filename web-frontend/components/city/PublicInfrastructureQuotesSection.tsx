//web-frontend/components/city/PublicInfrastructureQuotesSection.tsx

import type { CSSProperties } from "react";
import type { PublicInfrastructureStatusResponse, PublicServiceQuote, Resources } from "../../lib/api";

type PublicInfrastructureQuotesSectionProps = {
  serviceMode: string;
  infraStatus: PublicInfrastructureStatusResponse | null;
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  formatServiceLabel: (service: string) => string;
};

type Tone = "calm" | "watch" | "danger";

const toneStyles: Record<Tone, CSSProperties> = {
  calm: { borderColor: "#355d45", background: "rgba(30,70,40,0.16)" },
  watch: { borderColor: "#77603a", background: "rgba(90,70,30,0.16)" },
  danger: { borderColor: "#7a3d3d", background: "rgba(100,30,30,0.16)" },
};

function getQuoteTone(quote: PublicServiceQuote): Tone {
  if (quote.strainScore >= 8 || quote.queueMinutes >= 45) return "danger";
  if (quote.strainScore >= 5 || quote.queueMinutes >= 20) return "watch";
  return "calm";
}

export function PublicInfrastructureQuotesSection({
  serviceMode,
  infraStatus,
  formatLevy,
  formatServiceLabel,
}: PublicInfrastructureQuotesSectionProps) {
  const quotes = infraStatus?.quotes ?? [];
  const queueAverage = quotes.length ? Math.round(quotes.reduce((sum, quote) => sum + quote.queueMinutes, 0) / quotes.length) : 0;
  const highestStrain = quotes.reduce((max, quote) => Math.max(max, quote.strainScore), 0);
  const fastestDesk = quotes.length ? Math.min(...quotes.map((quote) => quote.queueMinutes)) : null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong>Projected service quotes ({serviceMode})</strong>
      <div style={{ fontSize: 12, opacity: 0.76 }}>
        Live desk estimates for civic services. Read this as the current toll, queue, and strain picture before committing the city to paperwork.
      </div>
      {quotes.length === 0 ? (
        <div style={{ opacity: 0.7 }}>No quote data.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <div style={{ border: "1px solid #355d45", background: "rgba(30,70,40,0.16)", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Service desks</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{quotes.length}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>quoted right now</div>
            </div>
            <div style={{ border: `1px solid ${highestStrain >= 8 ? "#7a3d3d" : "#77603a"}`, background: highestStrain >= 8 ? "rgba(100,30,30,0.16)" : "rgba(90,70,30,0.16)", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Highest strain</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{highestStrain}</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>worst current queue pressure</div>
            </div>
            <div style={{ border: "1px solid #555", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.72 }}>Average queue</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>+{queueAverage}m</div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>{fastestDesk != null ? `fastest desk +${fastestDesk}m` : "no queue data"}</div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {quotes.map((quote: PublicServiceQuote) => {
              const tone = getQuoteTone(quote);
              const toneStyle = toneStyles[tone];
              return (
                <div
                  key={quote.service}
                  style={{
                    border: `1px solid ${typeof toneStyle.borderColor === "string" ? toneStyle.borderColor : "#555"}`,
                    background: typeof toneStyle.background === "string" ? toneStyle.background : undefined,
                    borderRadius: 8,
                    padding: 10,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <strong>{formatServiceLabel(quote.service)}</strong>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.9 }}>
                      Levy {formatLevy(quote.levy)}
                    </span>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.9 }}>
                      Queue +{quote.queueMinutes}m
                    </span>
                    <span style={{ border: "1px solid #555", borderRadius: 999, padding: "2px 8px", fontSize: 12, opacity: 0.9 }}>
                      Strain {quote.strainScore}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.76 }}>
                    {tone === "danger"
                      ? "This desk is running hot; expect a painful civic wait or rougher public strain if you push it now."
                      : tone === "watch"
                        ? "The desk is serviceable, but this is no longer a cheap or clean queue."
                        : "The desk is in a workable state and should remain a relatively clean civic spend."}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.78 }}>{quote.note}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
