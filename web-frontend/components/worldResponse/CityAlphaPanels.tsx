//web-frontend/components/worldResponse/CityAlphaPanels.tsx

import type {
  CityAlphaScopeLockSummary,
  CityAlphaStatusSummary,
  EconomyCartelResponseState,
} from "../../lib/api";
import { CityAlphaScopeLockSection } from "./CityAlphaScopeLockSection";
import { CityAlphaStatusSection } from "./CityAlphaStatusSection";

type CityAlphaPanelsProps = {
  cityAlphaStatus: CityAlphaStatusSummary | null;
  cityAlphaScopeLock: CityAlphaScopeLockSummary | null;
  economyCartelResponseState: EconomyCartelResponseState | null;
  highlightedPressureCount: number;
  getThreatFamilyDisplayName: (family?: string) => string;
};

export function CityAlphaPanels({
  cityAlphaStatus,
  cityAlphaScopeLock,
  economyCartelResponseState,
  highlightedPressureCount,
  getThreatFamilyDisplayName,
}: CityAlphaPanelsProps) {
  return (
    <>
      <CityAlphaStatusSection
        cityAlphaStatus={cityAlphaStatus}
        highlightedPressureCount={highlightedPressureCount}
        getThreatFamilyDisplayName={getThreatFamilyDisplayName}
      />
      <CityAlphaScopeLockSection
        cityAlphaScopeLock={cityAlphaScopeLock}
        economyCartelResponseState={economyCartelResponseState}
      />
    </>
  );
}
