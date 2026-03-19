//web-frontend/components/city/CityIdentityCard.tsx

import type { CSSProperties } from "react";
import type { MeProfile } from "../../lib/api";

interface CityIdentityCardProps {
  me: MeProfile;
  cardStyle: (extra?: CSSProperties) => CSSProperties;
}

export function CityIdentityCard({ me, cardStyle }: CityIdentityCardProps) {
  const city = me.city ?? null;

  return (
    <div style={cardStyle()}>
      <div>
        <strong>User:</strong> {me.username ?? "(unknown)"}{" "}
        <span style={{ opacity: 0.7 }}>({me.userId ?? "?"})</span>
      </div>
      <div>
        <strong>City:</strong> {city ? `${city.name} (Tier ${city.tier})` : "No city yet"}
      </div>
    </div>
  );
}
