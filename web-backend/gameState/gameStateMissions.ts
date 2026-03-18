//web-backend/gameState/gameStateMissions.ts

import { generateMissionOffers } from "../domain/missions";
import { missionDurationConfig } from "../config";

import type { Army, ArmyResponseRole } from "../domain/armies";
import type { Hero, HeroAttachment, HeroResponseRole, HeroTrait } from "../domain/heroes";
import { getHeroAttachmentDef } from "./gameStateHeroes";
import type { MissionDefenseReceipt, MissionDifficulty, MissionOffer, MissionResponsePosture, MissionResponseTag, MissionSetback, MotherBrainPressureWindow, PressureMapConfidence, RecoveryContractKind, RewardBundle, ThreatFamily, ThreatWarning, WarningIntelQuality } from "../domain/missions";
import type { RegionId, World } from "../domain/world";
import { buildRecoveryContractWorldConsequence, buildSetbackWorldConsequence, pushWorldConsequence, summarizeWorldConsequences, recomputeWorldConsequenceState } from "../domain/worldConsequences";
import type {
  ActiveMission,
  CityAlphaScopeLockItem,
  CityAlphaScopeLockSummary,
  CityAlphaSeverity,
  CityAlphaStatusItem,
  CityAlphaStatusSummary,
  GameEventInput,
  PlayerState,
  Resources,
} from "../gameState";

export interface WarfrontAssaultResult {
  status: "ok" | "not_found" | "no_region" | "no_forces";
  message?: string;
  activeMission?: ActiveMission;
}

export interface GarrisonStrikeResult {
  status: "ok" | "not_found" | "no_region" | "no_hero";
  message?: string;
  activeMission?: ActiveMission;
}

export type MissionOutcomeKind = "success" | "partial" | "failure";

export interface MissionOutcome {
  kind: MissionOutcomeKind;
  successChance: number;
  roll: number;
  casualtyRate: number;
  heroInjury?: "none" | "light" | "severe";
  posture: MissionResponsePosture;
  budgetScore: number;
  setbacks: MissionSetback[];
}

export interface CompleteMissionResult {
  status: "ok" | "not_found" | "not_ready";
  message?: string;
  rewards?: RewardBundle;
  resources?: Resources;
  outcome?: MissionOutcome;
  receipt?: MissionDefenseReceipt;
}


export interface ThreatWarningSyncResult {
  warnings: ThreatWarning[];
  intelScore: number;
  intelQuality: WarningIntelQuality;
}

export interface MotherBrainPressureMapSyncResult {
  pressureMap: MotherBrainPressureWindow[];
  exposureScore: number;
  highestPressure: number;
}

export interface MissionStateDeps {
  gameState: { world: World };
  getPlayerState(playerId: string): PlayerState | undefined;
  tickPlayerState(ps: PlayerState, now: Date): void;
  pushEvent(ps: PlayerState, input: GameEventInput): void;
  applyRewards(ps: PlayerState, rewards: RewardBundle): void;
}

function computeIntelScore(ps: PlayerState): number {
  let score = 0;

  score += (ps.city.stats.security ?? 0) * 0.35;
  score += (ps.city.stats.infrastructure ?? 0) * 0.18;
  score += (ps.city.stats.arcaneSaturation ?? 0) * 0.05;

  for (const hero of ps.heroes ?? []) {
    if (hero.status !== "idle") continue;
    if (hero.role === "scout") score += 16;
    if ((hero.responseRoles ?? []).includes("recon")) score += 12;
    if ((hero.responseRoles ?? []).includes("command")) score += 5;
    for (const trait of hero.traits ?? []) {
      const reconBias = Number(trait.responseBias?.recon ?? 0);
      const commandBias = Number(trait.responseBias?.command ?? 0);
      score += reconBias * 0.35;
      score += commandBias * 0.1;
    }
    for (const attachment of getHeroAttachments(hero)) {
      if ((attachment.responseTags ?? []).includes("recon")) score += 8;
      if ((attachment.responseTags ?? []).includes("warding")) score += 4;
    }
  }

  for (const army of ps.armies ?? []) {
    if (army.status !== "idle") continue;
    if ((army.specialties ?? []).includes("recon")) score += 14;
    if ((army.specialties ?? []).includes("command")) score += 6;
    score += Math.max(0, (army.readiness ?? 0) - 50) * 0.08;
  }

  for (const techId of ps.researchedTechIds ?? []) {
    if (techId.startsWith("militia_training")) score += 5;
    if (techId.startsWith("urban_planning")) score += 4;
  }

  return Math.round(score);
}

function intelQualityFromScore(score: number): WarningIntelQuality {
  if (score >= 95) return "precise";
  if (score >= 70) return "clear";
  if (score >= 45) return "usable";
  return "faint";
}

function leadMinutesForWarning(severity: number, intelQuality: WarningIntelQuality): number {
  const base = intelQuality === "precise" ? 95 : intelQuality === "clear" ? 70 : intelQuality === "usable" ? 42 : 22;
  const severityDrag = Math.round(severity * 0.18);
  return Math.max(12, base - severityDrag);
}

function topResponseTags(mission: MissionOffer): MissionResponseTag[] {
  const tags = getMissionResponseTags(mission);
  return tags.length > 0 ? tags.slice(0, 3) : [mission.kind === "army" ? "frontline" : "recon"];
}

function threatFamilyLabel(family?: ThreatFamily): string {
  switch (family) {
    case "bandits": return "Bandits";
    case "mercs": return "Mercenaries";
    case "desperate_towns": return "Desperate towns";
    case "organized_hostile_forces": return "Organized hostile forces";
    case "early_planar_strike": return "Early planar strike";
    default: return "Hostile pressure";
  }
}

function warningHeadlineForMission(mission: MissionOffer, intelQuality: WarningIntelQuality): string {
  const prefix = intelQuality === "faint" ? "Uneasy reports" : intelQuality === "usable" ? "Field warning" : intelQuality === "clear" ? "Confirmed warning" : "Precise threat window";
  return `${prefix}: ${mission.title}`;
}

function warningDetailForMission(mission: MissionOffer, intelQuality: WarningIntelQuality, leadMinutes: number): string {
  const visibility = intelQuality === "faint"
    ? "Scattered reports suggest trouble, but the picture is incomplete."
    : intelQuality === "usable"
    ? "Scouts and stewards agree something is building."
    : intelQuality === "clear"
    ? "Multiple signals align on an approaching strike window."
    : "Scouts, command, and local watchers agree on where pressure will land.";
  const reasons = (mission.targetingReasons ?? []).slice(0, 2).join(" ");
  const familyDetail = mission.threatFamily ? `${threatFamilyLabel(mission.threatFamily)} are the likely source.` : "";
  return `${visibility} Expect impact pressure in roughly ${leadMinutes}m near ${mission.regionId}. ${familyDetail} ${mission.description} ${reasons}`.trim();
}

function warningActionForMission(mission: MissionOffer, hero: Hero | null, army: Army | null): string {
  const heroText = hero ? `${hero.name} (${(hero.responseRoles ?? []).join("/")})` : "your best idle hero";
  const armyText = army ? `${army.name} (${(army.specialties ?? []).join("/")})` : "your best idle army";
  const familyText = mission.threatFamily ? ` against ${threatFamilyLabel(mission.threatFamily).toLowerCase()}` : "";
  if (mission.kind === "hero") {
    return `Prepare ${heroText} for a ${topResponseTags(mission).join("/")} response${familyText} and keep a reserve army ready if the warning escalates.`;
  }
  return `Stage ${armyText} for a ${topResponseTags(mission).join("/")} response${familyText} and keep ${heroText} ready to plug intel or warding gaps.`;
}

export function syncThreatWarnings(ps: PlayerState, now: Date): ThreatWarningSyncResult {
  const offers = Array.isArray(ps.currentOffers) ? ps.currentOffers : [];
  const intelScore = computeIntelScore(ps);
  const intelQuality = intelQualityFromScore(intelScore);

  const prioritized = offers
    .filter((offer) => offer.difficulty !== "low" || offer.kind === "army")
    .slice()
    .sort((a, b) => {
      const severityA = (a.recommendedPower ?? 0) + (a.kind === "army" ? 40 : 15);
      const severityB = (b.recommendedPower ?? 0) + (b.kind === "army" ? 40 : 15);
      return severityB - severityA;
    })
    .slice(0, 3);

  const warnings: ThreatWarning[] = prioritized.map((mission, index) => {
    const severity = Math.max(18, Math.min(100, Math.round((mission.recommendedPower ?? 0) * 0.45 + (mission.kind === "army" ? 18 : 8))));
    const leadMinutes = leadMinutesForWarning(severity, intelQuality) + index * 8;
    const issuedAt = now.toISOString();
    const earliestImpactAt = new Date(now.getTime() + leadMinutes * 60_000).toISOString();
    const latestImpactAt = new Date(now.getTime() + (leadMinutes + 35) * 60_000).toISOString();
    const recommendedHero = pickHeroForMission(ps, mission);
    const recommendedArmy = mission.kind === "army" ? pickArmyForMission(ps, mission) : pickArmyForMission(ps, { ...mission, kind: "army" });

    return {
      id: `warn_${mission.id}`,
      missionId: mission.id,
      targetRegionId: mission.regionId,
      issuedAt,
      earliestImpactAt,
      latestImpactAt,
      severity,
      intelQuality,
      headline: warningHeadlineForMission(mission, intelQuality),
      detail: warningDetailForMission(mission, intelQuality, leadMinutes),
      responseTags: topResponseTags(mission),
      recommendedAction: warningActionForMission(mission, recommendedHero, recommendedArmy),
      recommendedHeroId: recommendedHero?.id,
      recommendedArmyId: recommendedArmy?.id,
      threatFamily: mission.threatFamily,
      targetingPressure: mission.targetingPressure,
      targetingReasons: mission.targetingReasons ? [...mission.targetingReasons] : [],
    };
  });

  ps.threatWarnings = warnings;
  return { warnings, intelScore, intelQuality };
}


function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function pressureConfidence(score: number): PressureMapConfidence {
  if (score >= 80) return "urgent";
  if (score >= 55) return "credible";
  return "watch";
}

function computeExposureScore(ps: PlayerState): number {
  const prosperity = Number(ps.city.stats.prosperity ?? 0);
  const infrastructure = Number(ps.city.stats.infrastructure ?? 0);
  const influence = Number(ps.city.stats.influence ?? 0);
  const arcane = Number(ps.city.stats.arcaneSaturation ?? 0);
  const security = Number(ps.city.stats.security ?? 0);
  const stress = Number(ps.cityStress?.total ?? 0);
  return clampPercent(prosperity * 0.32 + infrastructure * 0.16 + influence * 0.16 + arcane * 0.14 + stress * 0.14 - security * 0.22);
}

function summarizePressureWindow(window: MotherBrainPressureWindow): string {
  return `${threatFamilyLabel(window.threatFamily)} pressure ${window.pressureScore}/100 with ${window.confidence} confidence.`;
}

function detailPressureWindow(window: MotherBrainPressureWindow): string {
  const reasons = window.reasons.slice(0, 2).join(" ");
  const lanes = window.responseTags.join("/");
  return `Mother Brain precursor flags ${lanes} exposure. ${reasons}`.trim();
}

export function syncMotherBrainPressureMap(ps: PlayerState, now: Date): MotherBrainPressureMapSyncResult {
  const exposureScore = computeExposureScore(ps);
  const warnings = Array.isArray(ps.threatWarnings) ? ps.threatWarnings : [];
  const offers = Array.isArray(ps.currentOffers) ? ps.currentOffers : [];

  const familyBuckets = new Map<ThreatFamily, { pressure: number; reasons: string[]; tags: MissionResponseTag[]; earliest?: string; latest?: string; missionIds: string[] }>();

  for (const offer of offers) {
    const family = offer.threatFamily;
    if (!family) continue;
    const existing = familyBuckets.get(family) ?? { pressure: 0, reasons: [], tags: [], missionIds: [] };
    existing.pressure = Math.max(existing.pressure, Number(offer.targetingPressure ?? offer.recommendedPower ?? 0));
    existing.reasons.push(...(offer.targetingReasons ?? []));
    existing.tags.push(...(offer.responseTags ?? []));
    existing.missionIds.push(offer.id);
    familyBuckets.set(family, existing);
  }

  for (const warning of warnings) {
    const family = warning.threatFamily;
    if (!family) continue;
    const existing = familyBuckets.get(family) ?? { pressure: 0, reasons: [], tags: [], missionIds: [] };
    existing.pressure = Math.max(existing.pressure, Number(warning.targetingPressure ?? warning.severity ?? 0));
    existing.reasons.push(...(warning.targetingReasons ?? []));
    existing.tags.push(...(warning.responseTags ?? []));
    existing.earliest = existing.earliest ?? warning.earliestImpactAt;
    existing.latest = existing.latest ?? warning.latestImpactAt;
    if (warning.missionId) existing.missionIds.push(warning.missionId);
    familyBuckets.set(family, existing);
  }

  const windows: MotherBrainPressureWindow[] = Array.from(familyBuckets.entries())
    .map(([family, bucket], index) => {
      const combinedPressure = clampPercent(bucket.pressure * 0.72 + exposureScore * 0.28);
      const confidence = pressureConfidence(combinedPressure);
      const earliestWindowAt = bucket.earliest ?? new Date(now.getTime() + (25 + index * 10) * 60_000).toISOString();
      const latestWindowAt = bucket.latest ?? new Date(now.getTime() + (70 + index * 12) * 60_000).toISOString();
      const responseTags = Array.from(new Set(bucket.tags)).slice(0, 3) as MissionResponseTag[];
      const reasons = Array.from(new Set(bucket.reasons.filter(Boolean))).slice(0, 3);
      const window: MotherBrainPressureWindow = {
        id: `mb_pressure_${family}`,
        generatedAt: now.toISOString(),
        earliestWindowAt,
        latestWindowAt,
        pressureScore: combinedPressure,
        exposureScore,
        confidence,
        threatFamily: family,
        responseTags: responseTags.length ? responseTags : [family === "early_planar_strike" ? "warding" : "frontline"],
        reasons: reasons.length ? reasons : ["City exposure and hostile pressure are high enough to justify a watch window."],
        summary: "",
        detail: "",
        sourceMissionIds: Array.from(new Set(bucket.missionIds)).slice(0, 4),
      };
      window.summary = summarizePressureWindow(window);
      window.detail = detailPressureWindow(window);
      return window;
    })
    .sort((a, b) => b.pressureScore - a.pressureScore)
    .slice(0, 3);

  ps.motherBrainPressureMap = windows;
  return {
    pressureMap: windows,
    exposureScore,
    highestPressure: windows[0]?.pressureScore ?? 0,
  };
}

function cityAlphaSeverityFromScore(score: number): CityAlphaSeverity {
  if (score >= 75) return "critical";
  if (score >= 52) return "pressed";
  if (score >= 28) return "watch";
  return "calm";
}

function topCityAlphaItems(ps: PlayerState): CityAlphaStatusItem[] {
  const warningItems: CityAlphaStatusItem[] = (ps.threatWarnings ?? []).map((warning) => ({
    id: `warning_${warning.id}`,
    kind: "warning",
    headline: warning.headline,
    detail: warning.recommendedAction || warning.detail,
    severity: Math.max(0, Math.min(100, Number(warning.severity ?? 0))),
    when: warning.earliestImpactAt,
    threatFamily: warning.threatFamily,
    responseTags: [...(warning.responseTags ?? [])],
  }));

  const pressureItems: CityAlphaStatusItem[] = (ps.motherBrainPressureMap ?? []).map((window) => ({
    id: `pressure_${window.id}`,
    kind: "pressure",
    headline: window.summary,
    detail: window.detail,
    severity: Math.max(0, Math.min(100, Number(window.pressureScore ?? 0))),
    when: window.earliestWindowAt,
    threatFamily: window.threatFamily,
    responseTags: [...(window.responseTags ?? [])],
  }));

  const receiptItems: CityAlphaStatusItem[] = (ps.missionReceipts ?? []).slice(0, 4).map((receipt, index) => ({
    id: `receipt_${receipt.id}_${index}`,
    kind: "receipt",
    headline: receipt.summary,
    detail: receipt.setbacks?.length ? receipt.setbacks[0]!.detail : "Recent defense outcome recorded.",
    severity: receipt.outcome === "failure" ? 82 : receipt.outcome === "partial" ? 58 : 28,
    when: receipt.createdAt,
    threatFamily: receipt.threatFamily,
    responseTags: [],
  }));

  return [...warningItems, ...pressureItems, ...receiptItems]
    .sort((a, b) => b.severity - a.severity || ((a.when ?? "").localeCompare(b.when ?? "")))
    .slice(0, 5);
}


function buildCityAlphaScopeLockItems(ps: PlayerState): CityAlphaScopeLockSummary {
  const alreadyExists: CityAlphaScopeLockItem[] = [
    {
      id: "response_loop",
      bucket: "already_exists",
      label: "Playable response loop",
      detail: "Cities can recruit heroes, raise armies, assign them to missions, and resolve mission outcomes with readable receipts.",
    },
    {
      id: "warning_windows",
      bucket: "already_exists",
      label: "Warning and intel windows",
      detail: "Threat warnings and Mother Brain pressure windows surface lead time, threat families, and likely response lanes before impact.",
    },
    {
      id: "recovery_contracts",
      bucket: "already_exists",
      label: "Recovery and stabilization contracts",
      detail: "Post-setback burden can spawn stabilizing contracts that directly move recovery burden, trust, and pressure.",
    },
    {
      id: "command_board",
      bucket: "already_exists",
      label: "Readable alpha command board",
      detail: "The /me view now consolidates readiness, warnings, pressure, receipts, and tester focus into one board.",
    },
  ];

  const existsButWeak: CityAlphaScopeLockItem[] = [
    {
      id: "world_consequence",
      bucket: "exists_but_weak",
      label: "World consequence linkage is still shallow",
      detail: "City defenses change local pressure and receipts, but they do not yet meaningfully reshape world ownership, economy lanes, or long-run faction posture.",
    },
    {
      id: "mother_brain_mapper",
      bucket: "exists_but_weak",
      label: "Mother Brain map is read-only",
      detail: "The precursor pressure mapper is valuable for tester readability, but it still stops before conquest writing, autonomous follow-through, or strategic mutation.",
    },
    {
      id: "gear_depth",
      bucket: "exists_but_weak",
      label: "Gear depth is functional but thin",
      detail: "Hero gear now matters by slot and response tags, but the attachment catalog and workshop breadth are still alpha-thin.",
    },
    {
      id: "setback_variety",
      bucket: "exists_but_weak",
      label: "Setbacks are readable but not yet broad",
      detail: "Defense receipts now persist and sting, but setback families are still a narrow slice compared with the eventual city sim target.",
    },
  ];

  const missing: CityAlphaScopeLockItem[] = [
    {
      id: "player_city_vs_world",
      bucket: "missing",
      label: "Persistent city-to-world influence loop",
      detail: "City Alpha still lacks a fully wired path where successes and failures materially feed long-run region control, black market health, or UDM/world consequences.",
    },
    {
      id: "autonomous_mb_response",
      bucket: "missing",
      label: "Autonomous Mother Brain strategic follow-through",
      detail: "Pressure windows are visible, but Mother Brain does not yet escalate into a full strategic actor that rewrites pressure or city state on its own authority.",
    },
    {
      id: "alpha_onboarding",
      bucket: "missing",
      label: "Explicit alpha onboarding walkthrough",
      detail: "The board is readable, but there is still no dedicated guided intro flow that teaches testers how to run a full city warning-to-recovery loop.",
    },
  ];

  const exclusions: CityAlphaScopeLockItem[] = [
    {
      id: "conquest_sim",
      bucket: "excluded",
      label: "No full conquest simulation in City Alpha",
      detail: "Region ownership flips, empire-level conquest math, and broad world rewrites are explicitly out of scope for this alpha milestone.",
    },
    {
      id: "fully_live_economy",
      bucket: "excluded",
      label: "No full economy/world market integration",
      detail: "Black market, vendor, and UDM impact are not frozen as City Alpha completion criteria for this strike.",
    },
    {
      id: "autonomous_city_ai",
      bucket: "excluded",
      label: "No autonomous city governor AI",
      detail: "The alpha expects a tester-driven command board, not a fully self-running city manager.",
    },
    {
      id: "combat_client",
      bucket: "excluded",
      label: "No 2.5D/3D combat client requirement",
      detail: "City Alpha is locked to the web tester loop and does not require the future graphical client path to count as complete.",
    },
  ];

  if ((ps.heroes ?? []).length === 0) {
    existsButWeak.unshift({
      id: "hero_pool_thin_runtime",
      bucket: "exists_but_weak",
      label: "Current test city has no active hero pool",
      detail: "The system exists, but this particular state has no recruited heroes yet, so tester readability on specialist assignment is weaker than intended.",
    });
  }

  if ((ps.armies ?? []).length === 0) {
    existsButWeak.unshift({
      id: "army_pool_thin_runtime",
      bucket: "exists_but_weak",
      label: "Current test city has no ready army pool",
      detail: "The readiness/assignment loop exists, but this state has no raised armies to demonstrate it cleanly.",
    });
  }

  const alphaReadyPercent = Math.max(0, Math.min(100, Math.round(((alreadyExists.length * 1.0) + (existsButWeak.length * 0.45)) / (alreadyExists.length + existsButWeak.length + missing.length) * 100)));
  const ambiguityCount = 0;
  return {
    headline: "City Alpha scope lock is now explicit.",
    detail: `Already-exists ${alreadyExists.length}, weak ${existsButWeak.length}, missing ${missing.length}, exclusions ${exclusions.length}.`,
    frozenExclusions: exclusions.map((item) => item.label),
    alreadyExists,
    existsButWeak,
    missing,
    exclusions,
    ambiguityCount,
    alphaReadyPercent,
  };
}

export function summarizePlayerWorldConsequences(ps: PlayerState) {
  return {
    ...summarizeWorldConsequences(ps.worldConsequences ?? []),
    propagatedState: recomputeWorldConsequenceState(ps),
  };
}

export function summarizeCityAlphaScopeLock(ps: PlayerState): CityAlphaScopeLockSummary {
  return buildCityAlphaScopeLockItems(ps);
}

export function summarizeCityAlphaStatus(ps: PlayerState): CityAlphaStatusSummary {
  const idleHeroes = (ps.heroes ?? []).filter((hero) => hero.status === "idle");
  const readyArmies = (ps.armies ?? []).filter((army) => army.status === "idle" && Number(army.readiness ?? 0) >= 40);
  const averageArmyReadiness = readyArmies.length
    ? Math.round(readyArmies.reduce((sum, army) => sum + Number(army.readiness ?? 0), 0) / readyArmies.length)
    : 0;
  const warnings = ps.threatWarnings ?? [];
  const pressureMap = ps.motherBrainPressureMap ?? [];
  const receipts = ps.missionReceipts ?? [];
  const urgentPressureCount = pressureMap.filter((window) => window.confidence === "urgent").length;
  const recentReceiptCount = receipts.slice(0, 5).length;
  const nextImpactAt = [...warnings.map((warning) => warning.earliestImpactAt), ...pressureMap.map((window) => window.earliestWindowAt)]
    .filter(Boolean)
    .sort()[0];
  const dangerScore = Math.round(
    (warnings[0]?.severity ?? 0) * 0.34 +
    (pressureMap[0]?.pressureScore ?? 0) * 0.26 +
    Number(ps.cityStress?.threatPressure ?? 0) * 0.22 +
    Number(ps.cityStress?.recoveryBurden ?? 0) * 0.18,
  );
  const severity = cityAlphaSeverityFromScore(dangerScore);
  const testerFocus: string[] = [];
  if (warnings.length > 0) testerFocus.push(`Answer ${warnings.length} live warning${warnings.length === 1 ? "" : "s"} before the next impact window.`);
  if (urgentPressureCount > 0) testerFocus.push(`Mother Brain flags ${urgentPressureCount} urgent pressure window${urgentPressureCount === 1 ? "" : "s"}; keep a reserve response ready.`);
  if (Number(ps.cityStress?.recoveryBurden ?? 0) >= 35) testerFocus.push(`Recovery burden is ${Math.round(Number(ps.cityStress?.recoveryBurden ?? 0))}/100; prioritize stabilization contracts.`);
  if (readyArmies.length === 0) testerFocus.push("No army is above baseline readiness; reinforce before taking another hard defense.");
  if (idleHeroes.length === 0) testerFocus.push("All heroes are committed; tester readability depends on at least one idle specialist being visible.");
  if (testerFocus.length === 0) testerFocus.push("Board is readable and stable; run a warning-to-receipt loop to verify tester flow.");

  const headline = severity === "critical"
    ? "City Alpha is under heavy pressure."
    : severity === "pressed"
    ? "City Alpha pressure is elevated."
    : severity === "watch"
    ? "City Alpha is stable, but pressure windows are forming."
    : "City Alpha is calm enough for a clean tester pass.";
  const detail = nextImpactAt
    ? `Next likely impact window begins around ${new Date(nextImpactAt).toLocaleString()}.`
    : "No immediate hostile impact window is currently flagged.";

  const readinessScore = Math.max(0, Math.min(100, Math.round(idleHeroes.length * 10 + averageArmyReadiness * 0.65 - Number(ps.cityStress?.recoveryBurden ?? 0) * 0.25)));

  return {
    severity,
    headline,
    detail,
    readinessScore,
    idleHeroCount: idleHeroes.length,
    readyArmyCount: readyArmies.length,
    averageArmyReadiness,
    activeMissionCount: (ps.activeMissions ?? []).length,
    openWarningCount: warnings.length,
    urgentPressureCount,
    recentReceiptCount,
    recoveryBurden: Math.round(Number(ps.cityStress?.recoveryBurden ?? 0)),
    nextImpactAt,
    testerFocus: testerFocus.slice(0, 4),
    topItems: topCityAlphaItems(ps),
  };
}

function durationMinutesForDifficulty(diff: MissionDifficulty): number {
  const cfg = missionDurationConfig;
  switch (diff) {
    case "low":
      return cfg.low;
    case "medium":
      return cfg.medium;
    case "high":
      return cfg.high;
    case "extreme":
      return cfg.extreme;
    default:
      return cfg.medium;
  }
}

function getHeroAttachments(hero: Hero): HeroAttachment[] {
  return (hero.attachments ?? []).filter((entry): entry is HeroAttachment => Boolean(entry && entry.kind));
}

function getHeroAttachmentEffects(hero: Hero, mission: MissionOffer): { power: number; successBonus: number; injuryDelta: number; notes: string[] } {
  const tags = getMissionResponseTags(mission);
  let power = 0;
  let successBonus = 0;
  let injuryDelta = 0;
  const notes: string[] = [];

  for (const attachment of getHeroAttachments(hero)) {
    const def = getHeroAttachmentDef(attachment.kind);
    const responseTags = attachment.responseTags?.length ? attachment.responseTags : def?.responseTags ?? [];
    const overlap = responseTags.filter((tag) => tags.includes(tag));
    if (overlap.length > 0) {
      power += 8 + overlap.length * 4;
      successBonus += 0.02 + overlap.length * 0.01;
      notes.push(attachment.name);
    }

    const family = attachment.family ?? def?.family;
    if (family === "martial" && hero.responseRoles.includes("frontline") && tags.includes("frontline")) {
      power += 4;
      successBonus += 0.01;
    }
    if (family === "recon" && hero.responseRoles.includes("recon") && tags.includes("recon")) {
      power += 4;
      successBonus += 0.01;
    }
    if (family === "arcane" && hero.responseRoles.includes("warding") && (tags.includes("warding") || tags.includes("command"))) {
      power += 5;
      successBonus += 0.015;
    }

    if ((attachment.slot ?? def?.slot) === "utility" && tags.includes("recon")) injuryDelta -= 0.02;
    if ((attachment.slot ?? def?.slot) === "trinket" && tags.includes("frontline")) injuryDelta -= 0.015;
    if ((attachment.slot ?? def?.slot) === "focus" && tags.includes("warding")) injuryDelta -= 0.01;
  }

  return { power, successBonus, injuryDelta, notes };
}

function getMissionResponseTags(mission: MissionOffer): MissionResponseTag[] {
  return Array.isArray(mission.responseTags) ? mission.responseTags : [];
}

function scoreHeroForMission(hero: Hero, mission: MissionOffer): number {
  const tags = getMissionResponseTags(mission);
  let score = hero.power;
  for (const role of hero.responseRoles ?? []) {
    if (tags.includes(role)) score += 18;
  }
  for (const trait of hero.traits ?? []) {
    for (const [role, delta] of Object.entries(trait.responseBias ?? {})) {
      if (tags.includes(role as HeroResponseRole)) score += Number(delta ?? 0);
    }
  }
  score += getHeroAttachmentEffects(hero, mission).power;
  if ((hero.tags ?? []).includes("wounded")) score -= 14;
  return score;
}

function pickHeroForMission(ps: PlayerState, mission: MissionOffer, preferredHeroId?: string): Hero | null {
  const idle = ps.heroes.filter((h) => h.status === "idle");
  if (idle.length === 0) return null;
  if (preferredHeroId) {
    const exact = idle.find((hero) => hero.id === preferredHeroId);
    if (exact) return exact;
  }
  idle.sort((a, b) => scoreHeroForMission(b, mission) - scoreHeroForMission(a, mission) || b.power - a.power);
  return idle[0];
}

function scoreArmyForMission(army: Army, mission: MissionOffer): number {
  const tags = getMissionResponseTags(mission);
  let score = army.power * (0.6 + army.readiness / 100);
  for (const specialty of army.specialties ?? []) {
    if (tags.includes(specialty as MissionResponseTag)) score += 16;
  }
  if (army.type === "militia" && tags.includes("defense")) score += 10;
  if (army.type === "line" && tags.includes("command")) score += 10;
  if (army.type === "vanguard" && tags.includes("recon")) score += 10;
  return score;
}

function pickArmyForMission(ps: PlayerState, mission: MissionOffer, preferredArmyId?: string): Army | null {
  const idle = ps.armies.filter((a) => a.status === "idle");
  if (idle.length === 0) return null;
  if (preferredArmyId) {
    const exact = idle.find((army) => army.id === preferredArmyId);
    if (exact) return exact;
  }
  idle.sort((a, b) => scoreArmyForMission(b, mission) - scoreArmyForMission(a, mission) || b.power - a.power);
  return idle[0];
}

function buildRecoveryContractOffer(ps: PlayerState, kind: RecoveryContractKind, now: Date, slot: number): MissionOffer {
  const burden = Number(ps.cityStress.recoveryBurden ?? 0);
  const pressure = Number(ps.cityStress.threatPressure ?? 0);
  const trust = Number(ps.city.stats.unity ?? 0);
  const suffix = `${ps.city.regionId}_${kind}`;

  switch (kind) {
    case "stabilize_district":
      return {
        id: `contract_stabilize_${suffix}`,
        contractKind: kind,
        kind: "hero",
        difficulty: burden >= 70 ? "high" : burden >= 45 ? "medium" : "low",
        title: "Stabilize the District",
        description: "Send a trusted coordinator to quiet panic, re-open civic routines, and stop strain from hardening into unrest.",
        regionId: ps.city.regionId,
        recommendedPower: 58 + Math.round(burden * 0.45),
        expectedRewards: { influence: 24, knowledge: 14, wealth: 12 },
        risk: { casualtyRisk: burden >= 60 ? "moderate" : "low", heroInjuryRisk: burden >= 70 ? "moderate" : "low", notes: "City-centered contract: lowers recovery burden and rebuilds trust if handled well." },
        responseTags: ["command", "recovery"],
        contractPressureDelta: -4,
        contractTrustDelta: 5,
        contractRecoveryBurdenDelta: -12,
      };
    case "repair_works":
      return {
        id: `contract_repair_${suffix}`,
        contractKind: kind,
        kind: "army",
        difficulty: burden >= 75 ? "high" : "medium",
        title: "Repair the Outer Works",
        description: "Assign disciplined troops and labor cover to clear roads, shore up barricades, and restore defensive lanes before the next hit.",
        regionId: ps.city.regionId,
        recommendedPower: 78 + Math.round((pressure + burden) * 0.4),
        expectedRewards: { materials: 32, wealth: 18 },
        risk: { casualtyRisk: pressure >= 60 ? "moderate" : "low", notes: "City-centered contract: trims future pressure and lowers repair backlog." },
        responseTags: ["defense", "recovery", "frontline"],
        contractPressureDelta: -6,
        contractTrustDelta: 2,
        contractRecoveryBurdenDelta: -10,
      };
    case "relief_convoys":
      return {
        id: `contract_relief_${suffix}`,
        contractKind: kind,
        kind: "army",
        difficulty: pressure >= 70 ? "high" : "medium",
        title: "Escort Relief Convoys",
        description: "Push guarded food, medicine, and tools through strained lanes so shortages stop feeding rumor and theft.",
        regionId: ps.city.regionId,
        recommendedPower: 72 + Math.round(pressure * 0.38),
        expectedRewards: { food: 26, wealth: 16, influence: 10 },
        risk: { casualtyRisk: pressure >= 75 ? "high" : "moderate", notes: "City-centered contract: eases pressure and softens the burden on nearby districts." },
        responseTags: ["defense", "recovery", "command"],
        contractPressureDelta: -8,
        contractTrustDelta: 3,
        contractRecoveryBurdenDelta: -8,
      };
    case "counter_rumors":
    default:
      return {
        id: `contract_rumor_${suffix}`,
        contractKind: "counter_rumors",
        kind: "hero",
        difficulty: trust <= 35 || burden >= 65 ? "high" : "medium",
        title: "Counter Rumors and Panic",
        description: "Put a credible face in the streets, challenge bad information, and keep fear from driving citizens into hostile hands.",
        regionId: ps.city.regionId,
        recommendedPower: 62 + Math.round((100 - trust) * 0.32 + burden * 0.2),
        expectedRewards: { influence: 28, knowledge: 10 },
        risk: { casualtyRisk: "low", heroInjuryRisk: "low", notes: "City-centered contract: restores trust and keeps recovery from stalling out." },
        responseTags: ["recon", "command", "recovery"],
        contractPressureDelta: -3,
        contractTrustDelta: 7,
        contractRecoveryBurdenDelta: -6,
      };
  }
}

export function syncRecoveryContractsForState(ps: PlayerState, now: Date): void {
  const existingNonContracts = (ps.currentOffers ?? []).filter((offer) => !offer.contractKind);
  const burden = Number(ps.cityStress.recoveryBurden ?? 0);
  const pressure = Number(ps.cityStress.threatPressure ?? 0);
  const trust = Number(ps.city.stats.unity ?? 0);
  const recentSetbacks = (ps.missionReceipts ?? []).slice(0, 3).reduce((sum, receipt) => sum + (receipt.setbacks?.length ?? 0), 0);

  const desired: RecoveryContractKind[] = [];
  if (burden >= 18 || recentSetbacks >= 2) desired.push("stabilize_district");
  if (burden >= 32 || pressure >= 55) desired.push("repair_works");
  if (pressure >= 45 || Number(ps.resources.food ?? 0) <= 90) desired.push("relief_convoys");
  if (trust <= 55 || burden >= 40) desired.push("counter_rumors");

  const contractKinds = Array.from(new Set(desired)).slice(0, 2);
  const contracts = contractKinds.map((kind, index) => buildRecoveryContractOffer(ps, kind, now, index));
  ps.currentOffers = [...existingNonContracts, ...contracts];
}

function ensureOffers(ps: PlayerState): void {
  if (!ps.currentOffers || ps.currentOffers.length === 0) {
    ps.currentOffers = generateMissionOffers({
      city: ps.city,
      heroes: ps.heroes,
      armies: ps.armies,
      regionId: ps.city.regionId,
      regionThreat: ps.regionWar.find((entry) => entry.regionId === ps.city.regionId)?.threat ?? 0,
      cityThreatPressure: ps.cityStress.threatPressure ?? 0,
      cityStressTotal: ps.cityStress.total ?? 0,
    });
  }
  syncRecoveryContractsForState(ps, new Date());
}

export function startMissionForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  missionId: string,
  now: Date,
  preferredHeroId?: string,
  preferredArmyId?: string,
  responsePosture?: MissionResponsePosture
): ActiveMission | null {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return null;

  deps.tickPlayerState(ps, now);
  ensureOffers(ps);

  const mission = ps.currentOffers.find((m) => m.id === missionId);
  if (!mission) return null;

  const posture = normalizePosture(responsePosture);
  const committedResources = postureResourceCommitment(mission, posture, ps.resources);
  spendCommittedResources(ps, committedResources);

  let assignedHeroId: string | undefined;
  let assignedArmyId: string | undefined;

  const familyText = mission.threatFamily ? ` against ${threatFamilyLabel(mission.threatFamily).toLowerCase()}` : "";
  if (mission.kind === "hero") {
    const hero = pickHeroForMission(ps, mission, preferredHeroId);
    if (!hero) return null;
    hero.status = "on_mission";
    hero.currentMissionId = missionId;
    assignedHeroId = hero.id;
  } else if (mission.kind === "army") {
    const army = pickArmyForMission(ps, mission, preferredArmyId);
    if (!army) return null;
    army.status = "on_mission";
    army.currentMissionId = missionId;
    assignedArmyId = army.id;
  }

  const startedAt = now.toISOString();
  const minutes = durationMinutesForDifficulty(mission.difficulty);
  const finishesAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();

  const instanceId = `active_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const active: ActiveMission = {
    instanceId,
    mission,
    startedAt,
    finishesAt,
    responsePosture: posture,
    committedResources,
    assignedHeroId,
    assignedArmyId,
  };

  ps.activeMissions.push(active);

  deps.pushEvent(ps, {
    kind: "mission_start",
    message: `Mission started: ${mission.title} (${posture} posture)`,
    missionId: mission.id,
    heroId: assignedHeroId,
    armyId: assignedArmyId,
    regionId: mission.regionId as RegionId,
  });

  return active;
}

export function regenerateRegionMissionsForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  targetRegionId: RegionId,
  now: Date
): MissionOffer[] | null {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return null;

  deps.tickPlayerState(ps, now);

  const remaining = ps.currentOffers.filter((m) => m.regionId !== targetRegionId);
  const newOffers = generateMissionOffers({
    city: ps.city,
    heroes: ps.heroes,
    armies: ps.armies,
    regionId: targetRegionId,
    regionThreat: ps.regionWar.find((entry) => entry.regionId === targetRegionId)?.threat ?? 0,
    cityThreatPressure: ps.cityStress.threatPressure ?? 0,
    cityStressTotal: ps.cityStress.total ?? 0,
  });

  ps.currentOffers = [...remaining, ...newOffers];
  syncRecoveryContractsForState(ps, now);

  deps.pushEvent(ps, {
    kind: "mission_refresh_region",
    message: `Operations refreshed in ${targetRegionId}`,
  });

  return newOffers;
}

function difficultyFromDanger(dangerLevel: number, threat: number): MissionDifficulty {
  const score = dangerLevel * 10 + threat * 0.5;
  if (score < 40) return "low";
  if (score < 80) return "medium";
  if (score < 130) return "high";
  return "extreme";
}

export function startWarfrontAssaultForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  regionId: RegionId,
  now: Date
): WarfrontAssaultResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return { status: "not_found", message: "Player not found" };

  const shard = deps.gameState.world.shards[0];
  if (!shard) return { status: "no_region", message: "World shard missing" };

  const region = shard.regions.find((r) => r.id === regionId);
  if (!region) return { status: "no_region", message: "Region not found" };

  const rw = ps.regionWar.find((r) => r.regionId === regionId);
  if (!rw) return { status: "no_region", message: "No warfront state for that region" };

  deps.tickPlayerState(ps, now);

  const difficulty = difficultyFromDanger(region.dangerLevel, rw.threat);
  const minutes = durationMinutesForDifficulty(difficulty);
  const recommendedPower = region.dangerLevel * 120 + Math.round(rw.threat * 2);
  const missionId = `warfront_${region.id}_${Date.now()}`;

  const offer: MissionOffer = {
    id: missionId,
    kind: "army",
    difficulty,
    title: `Frontline Assault: ${region.name}`,
    description: `Commit forces to push back hostile presence in ${region.name}.`,
    regionId: region.id,
    recommendedPower,
    expectedRewards: {
      materials: 40 + region.dangerLevel * 20,
      wealth: 30 + region.dangerLevel * 15,
      influence: 2 + Math.floor(region.dangerLevel * 1.5),
    },
    risk: {
      casualtyRisk:
        difficulty === "low"
          ? "Low"
          : difficulty === "medium"
          ? "Moderate"
          : difficulty === "high"
          ? "Severe"
          : "Catastrophic",
      notes:
        "Assaulting a fortified warfront. Casualties scale with enemy threat and your army strength.",
    },
    responseTags: ["frontline", "command"],
  };

  const army = pickArmyForMission(ps, offer);
  if (!army) {
    return { status: "no_forces", message: "No idle armies available to assault this region." };
  }

  army.status = "on_mission";
  army.currentMissionId = missionId;

  const startedAt = now.toISOString();
  const finishesAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
  const instanceId = `active_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const active: ActiveMission = {
    instanceId,
    mission: offer,
    startedAt,
    finishesAt,
    responsePosture: "balanced",
    committedResources: postureResourceCommitment(offer, "balanced", ps.resources),
    assignedArmyId: army.id,
  };

  ps.activeMissions.push(active);

  deps.pushEvent(ps, {
    kind: "mission_start",
    message: `Warfront assault launched at ${region.name}`,
    missionId: offer.id,
    armyId: army.id,
    regionId: region.id,
  });

  return { status: "ok", activeMission: active };
}

export function startGarrisonStrikeForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  regionId: RegionId,
  now: Date
): GarrisonStrikeResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return { status: "not_found", message: "Player not found" };

  const shard = deps.gameState.world.shards[0];
  if (!shard) return { status: "no_region", message: "World shard missing" };

  const region = shard.regions.find((r) => r.id === regionId);
  if (!region) return { status: "no_region", message: "Region not found" };

  const rw = ps.regionWar.find((r) => r.regionId === regionId);
  if (!rw) return { status: "no_region", message: "No warfront state for that region" };

  deps.tickPlayerState(ps, now);

  const difficulty = difficultyFromDanger(region.dangerLevel, rw.threat);
  const minutes = durationMinutesForDifficulty(difficulty);
  const recommendedPower = region.dangerLevel * 80 + Math.round(rw.threat * 1.5);
  const missionId = `garrison_${region.id}_${Date.now()}`;

  const offer: MissionOffer = {
    id: missionId,
    kind: "hero",
    difficulty,
    title: `Lair Strike: ${region.name}`,
    description:
      "Dispatch a hero-led strike team to hit enemy lairs, caches, or lieutenants in the area.",
    regionId: region.id,
    recommendedPower,
    expectedRewards: {
      wealth: 20 + region.dangerLevel * 10,
      materials: 15 + region.dangerLevel * 8,
      mana: 5 + region.dangerLevel * 4,
      influence: 1 + Math.floor(region.dangerLevel * 0.8),
    },
    risk: {
      casualtyRisk:
        difficulty === "low"
          ? "Low"
          : difficulty === "medium"
          ? "Moderate"
          : difficulty === "high"
          ? "Severe"
          : "Catastrophic",
      heroInjuryRisk:
        difficulty === "low"
          ? "Low"
          : difficulty === "medium"
          ? "Moderate"
          : difficulty === "high"
          ? "High"
          : "Extreme",
      notes:
        "Fast-moving raid aimed at enemy lairs. High risk for lone heroes at high danger levels.",
    },
    responseTags: ["recon", "warding"],
  };

  const hero = pickHeroForMission(ps, offer);
  if (!hero) {
    return { status: "no_hero", message: "No idle heroes available for a garrison strike." };
  }

  hero.status = "on_mission";
  hero.currentMissionId = missionId;

  const startedAt = now.toISOString();
  const finishesAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
  const instanceId = `active_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const active: ActiveMission = {
    instanceId,
    mission: offer,
    startedAt,
    finishesAt,
    responsePosture: "balanced",
    committedResources: postureResourceCommitment(offer, "balanced", ps.resources),
    assignedHeroId: hero.id,
  };

  ps.activeMissions.push(active);

  deps.pushEvent(ps, {
    kind: "mission_start",
    message: `Hero raid launched in ${region.name}`,
    missionId: offer.id,
    heroId: hero.id,
    regionId: region.id,
  });

  return { status: "ok", activeMission: active };
}

function computeHeroMissionEffect(hero: Hero | undefined, mission: MissionOffer): { power: number; successBonus: number; injuryDelta: number; notes: string[] } {
  if (!hero) return { power: 0, successBonus: 0, injuryDelta: 0, notes: [] };
  const notes: string[] = [];
  const tags = getMissionResponseTags(mission);
  let effectivePower = hero.power;
  let successBonus = 0;
  let injuryDelta = 0;

  for (const role of hero.responseRoles ?? []) {
    if (tags.includes(role)) {
      effectivePower += 10;
      successBonus += 0.05;
      notes.push(`${role} fit`);
    }
  }

  for (const trait of hero.traits ?? []) {
    for (const [role, delta] of Object.entries(trait.responseBias ?? {})) {
      if (tags.includes(role as HeroResponseRole)) {
        const numeric = Number(delta ?? 0);
        effectivePower += numeric;
        successBonus += numeric / 400;
        if (numeric > 0) notes.push(trait.name);
      }
    }
    injuryDelta += trait.injuryDelta ?? 0;
    effectivePower += trait.powerDelta ?? 0;
  }

  const attachmentEffect = getHeroAttachmentEffects(hero, mission);
  effectivePower += attachmentEffect.power;
  successBonus += attachmentEffect.successBonus;
  injuryDelta += attachmentEffect.injuryDelta;
  notes.push(...attachmentEffect.notes);
  if ((hero.tags ?? []).includes("wounded")) {
    effectivePower = Math.max(5, effectivePower - 14);
    injuryDelta += 0.08;
    notes.push("wounded");
  }

  return { power: effectivePower, successBonus, injuryDelta, notes };
}

function computeArmyMissionEffect(army: Army | undefined, mission: MissionOffer): { power: number; successBonus: number; readinessDelta: number; notes: string[] } {
  if (!army) return { power: 0, successBonus: 0, readinessDelta: 0, notes: [] };
  const tags = getMissionResponseTags(mission);
  const notes: string[] = [];
  let effectivePower = army.power * (0.6 + army.readiness / 100);
  let successBonus = 0;
  let readinessDelta = 0;

  for (const specialty of army.specialties ?? []) {
    if (tags.includes(specialty as MissionResponseTag)) {
      effectivePower += 14;
      successBonus += 0.04;
      notes.push(`${specialty} fit`);
    }
  }

  if (army.type === "militia" && tags.includes("defense")) {
    effectivePower += 10;
    successBonus += 0.03;
    notes.push("militia defense doctrine");
  }
  if (army.type === "line" && tags.includes("command")) {
    effectivePower += 10;
    successBonus += 0.03;
    notes.push("line regiment discipline");
  }
  if (army.type === "vanguard" && tags.includes("recon")) {
    effectivePower += 10;
    successBonus += 0.03;
    notes.push("vanguard mobility");
  }

  if (army.readiness >= 90) {
    effectivePower += 12;
    successBonus += 0.04;
    notes.push("high readiness");
  } else if (army.readiness <= 45) {
    effectivePower -= 18;
    successBonus -= 0.06;
    readinessDelta += 0.06;
    notes.push("fatigued");
  }

  return { power: Math.max(5, Math.round(effectivePower)), successBonus, readinessDelta, notes };
}

function normalizePosture(posture: MissionResponsePosture | undefined): MissionResponsePosture {
  return posture ?? "balanced";
}

function postureResourceCommitment(mission: MissionOffer, posture: MissionResponsePosture, resources: Resources): Partial<Resources> {
  const mult = posture === "cautious" ? 0.5 : posture === "balanced" ? 0.8 : posture === "aggressive" ? 1.05 : 1.3;
  const base = mission.difficulty === "low" ? 8 : mission.difficulty === "medium" ? 16 : mission.difficulty === "high" ? 28 : 44;
  const wealthNeed = Math.round(base * mult + (mission.kind === "army" ? 8 : 4));
  const materialsNeed = Math.round(base * 0.7 * mult + (mission.kind === "army" ? 9 : 2));
  const manaNeed = mission.responseTags.includes("warding") ? Math.round(base * 0.45 * mult) : 0;
  const unityNeed = posture === "desperate" ? 10 : posture === "aggressive" ? 4 : 0;

  return {
    wealth: Math.min(resources.wealth, wealthNeed),
    materials: Math.min(resources.materials, materialsNeed),
    mana: Math.min(resources.mana, manaNeed),
    unity: Math.min(resources.unity, unityNeed),
  };
}

function spendCommittedResources(ps: PlayerState, committed: Partial<Resources> | undefined): void {
  if (!committed) return;
  for (const key of Object.keys(committed) as (keyof Resources)[]) {
    const amount = Math.max(0, Math.round(Number(committed[key] ?? 0)));
    if (!amount) continue;
    ps.resources[key] = Math.max(0, ps.resources[key] - amount);
  }
}

function budgetSupportScore(mission: MissionOffer, committed: Partial<Resources> | undefined): number {
  const total = Number(committed?.wealth ?? 0) + Number(committed?.materials ?? 0) + Number(committed?.mana ?? 0) * 1.2 + Number(committed?.unity ?? 0) * 1.5;
  const target = mission.difficulty === "low" ? 18 : mission.difficulty === "medium" ? 34 : mission.difficulty === "high" ? 56 : 82;
  return Math.max(0, Math.min(1.15, total / Math.max(12, target)));
}

function postureModifiers(posture: MissionResponsePosture): { success: number; casualty: number; stress: number } {
  switch (posture) {
    case "cautious":
      return { success: -0.04, casualty: -0.12, stress: -2 };
    case "aggressive":
      return { success: 0.06, casualty: 0.07, stress: 4 };
    case "desperate":
      return { success: 0.12, casualty: 0.15, stress: 8 };
    default:
      return { success: 0, casualty: 0, stress: 0 };
  }
}

function addSetback(target: MissionSetback[], setback: MissionSetback | null | undefined): void {
  if (setback) target.push(setback);
}

function computeMissionSetbacks(ps: PlayerState, active: ActiveMission, outcome: MissionOutcome): MissionSetback[] {
  const setbacks: MissionSetback[] = [];
  const posture = normalizePosture(active.responsePosture);
  const severityBase = outcome.kind === "failure" ? 3 : outcome.kind === "partial" ? 2 : 1;

  if (outcome.kind !== "success") {
    const wealthLoss = Math.max(0, Math.round((active.committedResources?.wealth ?? 0) * (outcome.kind === "failure" ? 0.45 : 0.2)));
    const materialsLoss = Math.max(0, Math.round((active.committedResources?.materials ?? 0) * (outcome.kind === "failure" ? 0.4 : 0.15)));
    if (wealthLoss || materialsLoss) {
      ps.resources.wealth = Math.max(0, ps.resources.wealth - wealthLoss);
      ps.resources.materials = Math.max(0, ps.resources.materials - materialsLoss);
      addSetback(setbacks, {
        kind: "resource_loss",
        severity: severityBase,
        summary: "Emergency spending and spoilage hit the treasury.",
        detail: `Lost wealth ${wealthLoss} and materials ${materialsLoss} while sustaining the response.`,
        resources: { wealth: wealthLoss, materials: materialsLoss },
      });
    }

    const secLoss = outcome.kind === "failure" ? 6 : 2;
    const stabLoss = outcome.kind === "failure" ? 5 : 2;
    const unityLoss = posture === "desperate" ? 4 : outcome.kind === "failure" ? 3 : 1;
    ps.city.stats.security = Math.max(0, ps.city.stats.security - secLoss);
    ps.city.stats.stability = Math.max(0, ps.city.stats.stability - stabLoss);
    ps.city.stats.unity = Math.max(0, ps.city.stats.unity - unityLoss);
    ps.cityStress.threatPressure = Math.min(100, ps.cityStress.threatPressure + (outcome.kind === "failure" ? 8 : 3));
    ps.cityStress.unityPressure = Math.min(100, ps.cityStress.unityPressure + (unityLoss + 2));
    ps.cityStress.recoveryBurden = Math.min(100, (ps.cityStress.recoveryBurden ?? 0) + (outcome.kind === "failure" ? 14 : 6));
    ps.cityStress.total = Math.min(100, ps.cityStress.total + (outcome.kind === "failure" ? 7 : 3));
    addSetback(setbacks, {
      kind: "unrest",
      severity: severityBase,
      summary: outcome.kind === "failure" ? "The city reels after a failed defense posture." : "The city absorbs visible strain from the response.",
      detail: `Security -${secLoss}, stability -${stabLoss}, unity -${unityLoss}.`,
      statImpacts: { security: -secLoss, stability: -stabLoss, unity: -unityLoss },
    });

    if (active.mission.kind === "army" && active.assignedArmyId) {
      const infraLoss = outcome.kind === "failure" ? 4 : 1;
      ps.city.stats.infrastructure = Math.max(0, ps.city.stats.infrastructure - infraLoss);
      addSetback(setbacks, {
        kind: "infrastructure_damage",
        severity: severityBase,
        summary: outcome.kind === "failure" ? "Outer works and roads took a beating." : "Forward defenses still took light damage.",
        detail: `Infrastructure -${infraLoss} from churn on the defensive line.`,
        statImpacts: { infrastructure: -infraLoss },
      });
    }

    addSetback(setbacks, {
      kind: "threat_surge",
      severity: severityBase,
      summary: "Hostile pressure rises after the clash.",
      detail: outcome.kind === "failure" ? "Enemies gained confidence and local fear spiked." : "The enemy was checked, but not cleanly enough to calm the frontier.",
      statImpacts: { threatPressure: outcome.kind === "failure" ? 8 : 3 },
    });
  }

  if (outcome.heroInjury && outcome.heroInjury !== "none") {
    addSetback(setbacks, {
      kind: "hero_injury",
      severity: outcome.heroInjury === "severe" ? 3 : 2,
      summary: outcome.heroInjury === "severe" ? "A hero came back badly hurt." : "A hero came back wounded.",
      detail: outcome.heroInjury === "severe" ? "Recovery time and reduced performance will linger." : "The hero needs time to recover before peak performance returns.",
    });
  }

  if (active.assignedArmyId && outcome.casualtyRate >= 0.22) {
    addSetback(setbacks, {
      kind: "army_attrition",
      severity: outcome.casualtyRate >= 0.45 ? 3 : 2,
      summary: "The assigned army took real losses.",
      detail: `Estimated casualty rate ${Math.round(outcome.casualtyRate * 100)}%. Readiness and manpower both dropped.`,
    });
  }

  return setbacks;
}

function buildMissionReceipt(active: ActiveMission, outcome: MissionOutcome, now: Date): MissionDefenseReceipt {
  const setbacks = outcome.setbacks ?? [];
  const posture = normalizePosture(active.responsePosture);
  const contractPrefix = active.mission.contractKind ? "Recovery contract" : active.mission.title;
  const summary = setbacks.length === 0
    ? `${contractPrefix}: ${outcome.kind.toUpperCase()} with ${posture} posture.`
    : `${contractPrefix}: ${outcome.kind.toUpperCase()} with ${setbacks.length} recorded setback${setbacks.length === 1 ? "" : "s"}.`;

  return {
    id: `receipt_${active.instanceId}`,
    missionId: active.mission.id,
    missionTitle: active.mission.title,
    createdAt: now.toISOString(),
    outcome: outcome.kind,
    posture,
    threatFamily: active.mission.threatFamily,
    summary,
    setbacks,
  };
}

function resolveMissionOutcome(ps: PlayerState, active: ActiveMission): MissionOutcome {
  const mission = active.mission;
  const recommended = mission.recommendedPower || 0;
  const posture = normalizePosture(active.responsePosture);
  const postureMod = postureModifiers(posture);
  const budgetScore = budgetSupportScore(mission, active.committedResources);

  let forcePower = 0;
  let heroEffect: ReturnType<typeof computeHeroMissionEffect> | null = null;
  let armyEffect: ReturnType<typeof computeArmyMissionEffect> | null = null;
  if (mission.kind === "hero" && active.assignedHeroId) {
    const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
    heroEffect = computeHeroMissionEffect(h, mission);
    forcePower = heroEffect.power;
  } else if (mission.kind === "army" && active.assignedArmyId) {
    const a = ps.armies.find((x) => x.id === active.assignedArmyId);
    armyEffect = computeArmyMissionEffect(a, mission);
    forcePower = armyEffect.power;
  }

  const safeRecommended = Math.max(10, recommended);
  const ratio = forcePower > 0 ? forcePower / safeRecommended : 0.5;

  let successChance = 0.4 + (ratio - 1) * 0.25;
  if (ratio >= 1.5) successChance += 0.15;
  if (ratio <= 0.5) successChance -= 0.15;
  if (heroEffect) successChance += heroEffect.successBonus;
  if (armyEffect) successChance += armyEffect.successBonus;
  successChance += (budgetScore - 0.55) * 0.18;
  successChance += postureMod.success;
  successChance = Math.max(0.08, Math.min(0.96, successChance));

  const roll = Math.random();

  let kind: MissionOutcomeKind;
  if (roll < successChance * 0.7) {
    kind = "success";
  } else if (roll < successChance * 1.1) {
    kind = "partial";
  } else {
    kind = "failure";
  }

  let casualtyRate: number;
  switch (kind) {
    case "success":
      casualtyRate = 0.05 + Math.random() * 0.1;
      break;
    case "partial":
      casualtyRate = 0.15 + Math.random() * 0.2;
      break;
    case "failure":
      casualtyRate = 0.35 + Math.random() * 0.4;
      break;
  }

  casualtyRate += postureMod.casualty;
  if (budgetScore >= 0.95) casualtyRate -= 0.04;
  else if (budgetScore <= 0.4) casualtyRate += 0.06;

  if (heroEffect) {
    casualtyRate = Math.max(0.03, Math.min(0.95, casualtyRate + heroEffect.injuryDelta));
  }
  if (armyEffect) {
    casualtyRate = Math.max(0.03, Math.min(0.95, casualtyRate + armyEffect.readinessDelta));
  }

  let heroInjury: MissionOutcome["heroInjury"] = "none";
  if (mission.kind === "hero") {
    if (casualtyRate > 0.5) heroInjury = "severe";
    else if (casualtyRate > 0.25) heroInjury = "light";
  }

  const outcome: MissionOutcome = { kind, successChance, roll, casualtyRate, heroInjury, posture, budgetScore, setbacks: [] };
  outcome.setbacks = computeMissionSetbacks(ps, active, outcome);
  return outcome;
}

function applyCasualtiesAndXp(ps: PlayerState, active: ActiveMission, outcome: MissionOutcome): void {
  const rate = outcome.casualtyRate;
  if (rate <= 0) return;

  if (active.assignedArmyId) {
    const a = ps.armies.find((x) => x.id === active.assignedArmyId);
    if (a) {
      const loss = Math.max(1, Math.round(a.size * rate));
      a.size = Math.max(1, a.size - loss);
      const powerMult = 1 - rate * 0.7;
      a.power = Math.max(5, Math.round(a.power * powerMult));
      a.readiness = Math.max(20, Math.round(a.readiness - rate * 35));
      a.upkeep = {
        wealth: Math.max(2, Math.round(a.power * 0.08 + a.size * 0.01)),
        materials: Math.max(1, Math.round(a.power * 0.05 + a.size * 0.006)),
      };
    }
  }

  if (active.assignedHeroId) {
    const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
    if (h) {
      if (outcome.heroInjury === "light") {
        if (!h.tags.includes("wounded")) h.tags = [...h.tags, "wounded"];
      } else if (outcome.heroInjury === "severe") {
        if (!h.tags.includes("wounded")) h.tags = [...h.tags, "wounded"];
        h.power = Math.max(10, Math.round(h.power * 0.9));
      }

      let baseXp: number;
      switch (active.mission.difficulty) {
        case "low":
          baseXp = 10;
          break;
        case "medium":
          baseXp = 20;
          break;
        case "high":
          baseXp = 35;
          break;
        case "extreme":
          baseXp = 50;
          break;
        default:
          baseXp = 20;
          break;
      }

      let mult = 1;
      switch (outcome.kind) {
        case "success":
          mult = 1.3;
          break;
        case "partial":
          mult = 1.0;
          break;
        case "failure":
          mult = 0.5;
          break;
      }

      if (baseXp > 0) {
        if (!h.level || h.level < 1) h.level = 1;
        if (!h.xpToNext || h.xpToNext < 10) h.xpToNext = 100;
        if (h.xp == null) h.xp = 0;
        h.xp += Math.round(baseXp * mult);
        while (h.xp >= h.xpToNext) {
          h.xp -= h.xpToNext;
          h.level += 1;
          h.xpToNext = Math.round(h.xpToNext * 1.25);
        }
      }
    }
  }
}

function applyMissionImpactToRegion(ps: PlayerState, mission: MissionOffer, outcome: MissionOutcome): { controlDelta: number; threatDelta: number } {
  const region = ps.regionWar.find((rw) => rw.regionId === mission.regionId);
  if (!region) return { controlDelta: 0, threatDelta: 0 };

  let controlDelta = 0;
  let threatDelta = 0;

  switch (outcome.kind) {
    case "success":
      controlDelta = 5;
      threatDelta = -5;
      break;
    case "partial":
      controlDelta = 2;
      threatDelta = -2;
      break;
    case "failure":
      controlDelta = -3;
      threatDelta = 4;
      break;
  }

  region.control = Math.max(0, Math.min(100, region.control + controlDelta));
  region.threat = Math.max(0, Math.min(100, region.threat + threatDelta));
  return { controlDelta, threatDelta };
}

function applyRecoveryContractEffects(ps: PlayerState, active: ActiveMission, outcome: MissionOutcome): { pressureDelta: number; trustDelta: number; recoveryDelta: number } {
  if (!active.mission.contractKind) return { pressureDelta: 0, trustDelta: 0, recoveryDelta: 0 };

  const pressureDelta = Number(active.mission.contractPressureDelta ?? 0);
  const trustDelta = Number(active.mission.contractTrustDelta ?? 0);
  const burdenDelta = Number(active.mission.contractRecoveryBurdenDelta ?? 0);

  if (outcome.kind === "success") {
    ps.cityStress.threatPressure = Math.max(0, ps.cityStress.threatPressure + pressureDelta);
    ps.city.stats.unity = Math.max(0, Math.min(100, ps.city.stats.unity + trustDelta));
    ps.cityStress.recoveryBurden = Math.max(0, (ps.cityStress.recoveryBurden ?? 0) + burdenDelta);
    return { pressureDelta, trustDelta, recoveryDelta: burdenDelta };
  }
  if (outcome.kind === "partial") {
    const partialPressure = Math.round(pressureDelta * 0.4);
    const partialTrust = Math.round(trustDelta * 0.4);
    const partialBurden = Math.round(burdenDelta * 0.45);
    ps.cityStress.threatPressure = Math.max(0, ps.cityStress.threatPressure + partialPressure);
    ps.city.stats.unity = Math.max(0, Math.min(100, ps.city.stats.unity + partialTrust));
    ps.cityStress.recoveryBurden = Math.max(0, (ps.cityStress.recoveryBurden ?? 0) + partialBurden);
    return { pressureDelta: partialPressure, trustDelta: partialTrust, recoveryDelta: partialBurden };
  }

  const failurePressure = Math.max(3, Math.round(Math.abs(pressureDelta) * 0.6));
  const failureTrust = -Math.max(2, Math.round(Math.max(1, trustDelta) * 0.6));
  const failureBurden = Math.max(5, Math.round(Math.abs(burdenDelta) * 0.7));
  ps.cityStress.threatPressure = Math.min(100, ps.cityStress.threatPressure + failurePressure);
  ps.city.stats.unity = Math.max(0, Math.min(100, ps.city.stats.unity + failureTrust));
  ps.cityStress.recoveryBurden = Math.min(100, (ps.cityStress.recoveryBurden ?? 0) + failureBurden);
  return { pressureDelta: failurePressure, trustDelta: failureTrust, recoveryDelta: failureBurden };
}

export function completeMissionForPlayer(
  deps: MissionStateDeps,
  playerId: string,
  instanceId: string,
  now: Date
): CompleteMissionResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) return { status: "not_found", message: "Player not found" };

  deps.tickPlayerState(ps, now);

  const index = ps.activeMissions.findIndex((am) => am.instanceId === instanceId);
  if (index === -1) return { status: "not_found", message: "Mission instance not found" };

  const active = ps.activeMissions[index];
  const finishTime = new Date(active.finishesAt).getTime();
  if (now.getTime() < finishTime) {
    return { status: "not_ready", message: "Mission is still in progress" };
  }

  const outcome = resolveMissionOutcome(ps, active);
  applyCasualtiesAndXp(ps, active, outcome);

  if (active.assignedHeroId) {
    const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
    if (h) {
      h.status = "idle";
      h.currentMissionId = undefined;
    }
  }
  if (active.assignedArmyId) {
    const a = ps.armies.find((x) => x.id === active.assignedArmyId);
    if (a) {
      a.status = "idle";
      a.currentMissionId = undefined;
      a.readiness = Math.max(20, a.readiness - 6);
    }
  }

  const rewards = active.mission.expectedRewards;
  deps.applyRewards(ps, rewards);
  const regionImpact = applyMissionImpactToRegion(ps, active.mission, outcome);
  const recoveryImpact = applyRecoveryContractEffects(ps, active, outcome);
  const receipt = buildMissionReceipt(active, outcome, now);
  ps.missionReceipts = [receipt, ...(ps.missionReceipts ?? [])].slice(0, 20);

  if ((receipt.setbacks?.length ?? 0) > 0 && outcome.kind !== "success") {
    const fallbackControlDelta = outcome.kind === "failure" ? -3 : -1;
    const fallbackThreatDelta = outcome.kind === "failure" ? 4 : 1;
    pushWorldConsequence(ps, buildSetbackWorldConsequence({
      missionId: active.mission.id,
      missionTitle: active.mission.title,
      regionId: active.mission.regionId,
      threatFamily: active.mission.threatFamily,
      outcome: outcome.kind,
      pressureDelta: outcome.kind === "failure" ? 8 : 3,
      recoveryDelta: outcome.kind === "failure" ? 14 : 6,
      controlDelta: regionImpact.controlDelta !== 0 ? regionImpact.controlDelta : fallbackControlDelta,
      threatDelta: regionImpact.threatDelta !== 0 ? regionImpact.threatDelta : fallbackThreatDelta,
      setbackCount: receipt.setbacks.length,
    }));
  }

  if (active.mission.contractKind) {
    pushWorldConsequence(ps, buildRecoveryContractWorldConsequence({
      missionId: active.mission.id,
      missionTitle: active.mission.title,
      regionId: active.mission.regionId,
      contractKind: active.mission.contractKind,
      outcome: outcome.kind,
      pressureDelta: recoveryImpact.pressureDelta,
      recoveryDelta: recoveryImpact.recoveryDelta,
      trustDelta: recoveryImpact.trustDelta,
    }));
  }

  deps.pushEvent(ps, {
    kind: "mission_complete",
    message: `${receipt.summary}`,
    missionId: active.mission.id,
    heroId: active.assignedHeroId,
    armyId: active.assignedArmyId,
    regionId: active.mission.regionId as RegionId,
    outcome: outcome.kind,
  });

  ps.activeMissions.splice(index, 1);
  syncRecoveryContractsForState(ps, now);
  recomputeWorldConsequenceState(ps);

  return { status: "ok", rewards, resources: ps.resources, outcome, receipt };
}
