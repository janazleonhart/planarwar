// web-frontend/components/city/MePageViewModel.ts

import type {
  CityMudBridgeStatusResponse,
  MeProfile,
  MissionBoardResponse,
  PublicInfrastructureStatusResponse,
  PublicServiceQuote,
} from "../../lib/api";

export function buildMePageViewModel(
  me: MeProfile | null,
  infraStatus: PublicInfrastructureStatusResponse | null,
  bridgeStatus: CityMudBridgeStatusResponse | null,
  missionBoard: MissionBoardResponse | null
) {
  const techOptions = me?.availableTechs ?? [];
  const infraSummary = infraStatus?.summary ?? null;
  const receipts = me?.publicInfrastructure?.receipts ?? [];
  const quoteMap = new Map<PublicServiceQuote["service"], PublicServiceQuote>(
    (infraStatus?.quotes ?? []).map((quote) => [quote.service, quote])
  );
  const bridgeSummary = bridgeStatus?.summary ?? null;
  const bridgeConsumers = bridgeStatus?.consumers ?? null;
  const missionOffers = missionBoard?.missions ?? [];
  const activeMissions = missionBoard?.activeMissions ?? me?.activeMissions ?? [];
  const threatWarnings = missionBoard?.threatWarnings ?? me?.threatWarnings ?? [];
  const motherBrainPressureMap = missionBoard?.motherBrainPressureMap ?? me?.motherBrainPressureMap ?? [];
  const missionReceipts = me?.missionReceipts ?? [];
  const cityAlphaStatus = me?.cityAlphaStatus ?? null;
  const cityAlphaScopeLock = me?.cityAlphaScopeLock ?? null;
  const highlightedWarnings = [...threatWarnings].sort((a, b) => b.severity - a.severity).slice(0, 3);
  const highlightedPressure = [...motherBrainPressureMap].sort((a, b) => b.pressureScore - a.pressureScore).slice(0, 3);
  const highlightedReceipts = [...missionReceipts].slice(0, 5);
  const worldConsequences = me?.worldConsequences ?? [];
  const worldConsequenceState = me?.worldConsequenceState ?? null;
  const worldConsequenceHooks = me?.worldConsequenceHooks ?? null;
  const worldConsequenceActions = me?.worldConsequenceActions ?? null;
  const worldConsequenceResponseReceipts = me?.worldConsequenceResponseReceipts ?? null;
  const worldConsequenceConsumers = me?.worldConsequenceConsumers ?? null;
  const economyCartelResponseState = me?.economyCartelResponseState ?? null;

  return {
    activeMissions,
    bridgeConsumers,
    bridgeSummary,
    cityAlphaScopeLock,
    cityAlphaStatus,
    economyCartelResponseState,
    highlightedPressure,
    highlightedReceipts,
    highlightedWarnings,
    infraSummary,
    missionOffers,
    quoteMap,
    receipts,
    techOptions,
    worldConsequenceActions,
    worldConsequenceConsumers,
    worldConsequenceHooks,
    worldConsequenceResponseReceipts,
    worldConsequenceState,
    worldConsequences,
  };
}
