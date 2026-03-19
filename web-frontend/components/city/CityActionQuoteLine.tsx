//web-frontend/components/city/CityActionQuoteLine.tsx

import type { PublicServiceQuote, Resources } from "../../lib/api";

type CityActionQuoteLineProps = {
  label: string;
  quote: PublicServiceQuote | undefined;
  formatLevy: (levy: Partial<Resources> | undefined) => string;
  prefix?: string;
};

export function CityActionQuoteLine({
  label,
  quote,
  formatLevy,
  prefix,
}: CityActionQuoteLineProps) {
  return (
    <div style={{ fontSize: 12, opacity: 0.75 }}>
      {prefix ? <>{prefix} </> : null}
      {label}: {formatLevy(quote?.levy)} / +{quote?.queueMinutes ?? 0}m
    </div>
  );
}
