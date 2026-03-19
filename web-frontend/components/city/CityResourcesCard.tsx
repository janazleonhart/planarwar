//web-frontend/components/city/CityResourcesCard.tsx

import type { CSSProperties } from "react";
import type { Resources } from "../../lib/api";

interface CityResourcesCardProps {
  resources: Resources;
  cardStyle: (extra?: CSSProperties) => CSSProperties;
}

const RESOURCE_ORDER: Array<keyof Resources> = [
  "food",
  "materials",
  "wealth",
  "mana",
  "knowledge",
  "unity",
];

function formatResourceLabel(key: keyof Resources): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function CityResourcesCard({ resources, cardStyle }: CityResourcesCardProps) {
  return (
    <div style={cardStyle()}>
      <h3 style={{ marginTop: 0 }}>Resources</h3>
      {RESOURCE_ORDER.map((key) => (
        <div key={key}>
          {formatResourceLabel(key)}: {resources[key]}
        </div>
      ))}
    </div>
  );
}
