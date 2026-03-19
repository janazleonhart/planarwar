//web-backend/domain/cityMudBridgeVendorPolicy.ts

import type {
  CityMudBridgeSummary,
  CityMudConsumerState,
  CityMudConsumerSummary,
  CityMudVendorLane,
  CityMudVendorLaneBias,
  CityMudVendorLanePolicy,
  CityMudVendorLaneProfile,
  CityMudVendorPreset,
  CityMudVendorPresetKey,
  CityMudVendorPresetRecommendation,
  CityMudVendorResponsePhase,
  CityMudVendorSupportPolicy,
} from "./cityMudBridge";

export const ALL_CITY_MUD_VENDOR_LANES: CityMudVendorLane[] = ["essentials", "comfort", "luxury", "arcane"];
export const ALL_CITY_MUD_VENDOR_PRESET_KEYS: CityMudVendorPresetKey[] = [
  "scarcity_essentials_protection",
  "luxury_throttle",
  "arcane_caution",
  "broad_recovery",
];

function clampVendorNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function isCityMudVendorLane(value: unknown): value is CityMudVendorLane {
  return typeof value === "string" && (ALL_CITY_MUD_VENDOR_LANES as string[]).includes(value);
}

export function normalizeVendorLaneSelection(values: unknown): CityMudVendorLane[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<CityMudVendorLane>();
  const lanes: CityMudVendorLane[] = [];
  for (const value of values) {
    if (!isCityMudVendorLane(value) || seen.has(value)) continue;
    seen.add(value);
    lanes.push(value);
  }
  return lanes;
}

export function describeVendorLaneSelection(lanes: CityMudVendorLane[]): string {
  if (lanes.length === 0) return "selected rows";
  if (lanes.length === 1) return `${lanes[0]} lane`;
  if (lanes.length === ALL_CITY_MUD_VENDOR_LANES.length) return "all lanes";
  return `${lanes.join(", ")} lanes`;
}

export function isCityMudVendorPresetKey(value: unknown): value is CityMudVendorPresetKey {
  return typeof value === "string" && (ALL_CITY_MUD_VENDOR_PRESET_KEYS as string[]).includes(value);
}

export function deriveVendorPresetRecommendation(input: {
  policyState: CityMudConsumerState;
  responsePhase?: CityMudVendorResponsePhase | null;
  laneBias?: CityMudVendorLaneBias | null;
}): CityMudVendorPresetRecommendation | null {
  const responsePhase = input.responsePhase ?? null;
  const laneBias = input.laneBias ?? null;

  let key: CityMudVendorPresetKey | null = null;
  let reason = "";
  let note = "";

  if (responsePhase === "severe" || input.policyState === "restricted" || laneBias === "essentials_only") {
    key = "scarcity_essentials_protection";
    reason = "Severe response or restricted vendor posture should protect essentials first.";
    note = "This is the safest bounded preset when runtime pressure is hot enough to squeeze shelves broadly.";
  } else if (laneBias === "luxury_throttle") {
    key = "luxury_throttle";
    reason = "Live response pressure is explicitly asking luxury lanes to absorb pain first.";
    note = "Use this when cartel/black-market heat is real but you do not need full scarcity theater across every lane.";
  } else if (laneBias === "arcane_caution") {
    key = "arcane_caution";
    reason = "Live response pressure is asking arcane lanes to stay available with measured caution.";
    note = "Use this when active pressure should slow fragile or magical inventory without pretending everything is collapsing.";
  } else if (responsePhase === "quiet" && (input.policyState === "stable" || input.policyState === "abundant")) {
    key = "broad_recovery";
    reason = "Quiet response conditions can support broad recovery instead of emergency throttling.";
    note = "This is a recovery preset, not a pressure preset; use it only when the response phase has cooled off.";
  }

  if (!key) return null;
  const preset = getVendorPreset(key);
  return {
    key: preset.key,
    label: preset.label,
    laneFilters: [...preset.laneFilters],
    reason,
    note,
  };
}

export function getVendorPreset(key: CityMudVendorPresetKey): CityMudVendorPreset {
  switch (key) {
    case "scarcity_essentials_protection":
      return {
        key,
        label: "Scarcity essentials protection",
        detail: "Protect essentials first when city support is tight, leaving comfort and luxury lanes untouched.",
        laneFilters: ["essentials"],
        recommendedAction: "Use during scarcity or civic strain to keep bread-and-bolts stock alive.",
      };
    case "luxury_throttle":
      return {
        key,
        label: "Luxury throttle",
        detail: "Throttle luxury stock first so pressure lands on optional indulgence before civic basics.",
        laneFilters: ["luxury"],
        recommendedAction: "Use when you want visible scarcity to hit non-essential stock before protected lanes.",
      };
    case "arcane_caution":
      return {
        key,
        label: "Arcane caution",
        detail: "Apply guarded pressure only to arcane lanes when mystical supply should remain viable but cautious.",
        laneFilters: ["arcane"],
        recommendedAction: "Use when mana-side supply should stay alive without being treated like staple goods.",
      };
    case "broad_recovery":
    default:
      return {
        key: "broad_recovery",
        label: "Broad recovery",
        detail: "Apply guarded recovery posture across all vendor lanes during stabilization or post-crisis easing.",
        laneFilters: [...ALL_CITY_MUD_VENDOR_LANES],
        recommendedAction: "Use when the city is recovering and you want a broad, audited policy pass.",
      };
  }
}

export function normalizeVendorPresetKey(value: unknown): CityMudVendorPresetKey | null {
  return isCityMudVendorPresetKey(value) ? value : null;
}

export function matchesVendorLaneSelection(policy: Pick<CityMudVendorLanePolicy, "lane"> | null | undefined, lanes: CityMudVendorLane[]): boolean {
  if (lanes.length === 0) return true;
  if (!policy) return false;
  return lanes.includes(policy.lane);
}

function detectVendorLane(input: { itemId?: string | null; itemName?: string | null; itemRarity?: string | null }): CityMudVendorLaneProfile {
  const id = String(input.itemId ?? "").toLowerCase();
  const name = String(input.itemName ?? "").toLowerCase();
  const rarity = String(input.itemRarity ?? "").toLowerCase();
  const haystack = `${id} ${name}`;

  const hasAny = (tokens: string[]) => tokens.some((token) => haystack.includes(token));

  if (rarity.includes("legend") || rarity.includes("epic") || rarity.includes("myth") || rarity.includes("relic") || hasAny(["luxury", "gem", "jewel", "feast", "wine", "crown", "silk"])) {
    return {
      lane: "luxury",
      label: "Luxury goods",
      detail: "Luxury and prestige inventory should feel scarcity first when the city-mud bridge is under pressure.",
      recommendedAction: "Throttle comfort and prestige stock before touching staples.",
    };
  }

  if (hasAny(["mana", "scroll", "rune", "tome", "glyph", "wand", "staff", "crystal", "focus"])) {
    return {
      lane: "arcane",
      label: "Arcane stock",
      detail: "Arcane inventory should stay viable, but it can tolerate some caution when logistics tighten.",
      recommendedAction: "Keep magical staples available, but avoid pretending ritual stock is infinite.",
    };
  }

  if (hasAny(["food", "bread", "ration", "water", "bandage", "herb", "ore", "wood", "stone", "cloth", "torch", "potion"])) {
    return {
      lane: "essentials",
      label: "Essentials",
      detail: "Staples and basic survival goods should be protected even when other lanes are throttled.",
      recommendedAction: "Favor staple stock, milder price pressure, and faster cadence recovery.",
    };
  }

  return {
    lane: "comfort",
    label: "Comfort goods",
    detail: "Comfort goods can track the baseline vendor posture without the hard priority of essentials or the fragility of luxury stock.",
    recommendedAction: "Let comfort stock follow baseline pressure unless a stronger lane bias is needed.",
  };
}

export function deriveVendorLanePolicy(
  _summary: CityMudBridgeSummary,
  _consumers: CityMudConsumerSummary,
  basePolicy: CityMudVendorSupportPolicy,
  input: { itemId?: string | null; itemName?: string | null; itemRarity?: string | null },
): CityMudVendorLanePolicy {
  const profile = detectVendorLane(input);
  let stock = basePolicy.recommendedStockMultiplier;
  let priceMin = basePolicy.recommendedPriceMinMultiplier;
  let priceMax = basePolicy.recommendedPriceMaxMultiplier;
  let cadence = basePolicy.recommendedRestockCadenceMultiplier;
  let headline = basePolicy.headline;
  const detail = `${basePolicy.detail} ${profile.detail}`;
  const action = `${basePolicy.recommendedAction} ${profile.recommendedAction}`;

  if (profile.lane === "essentials") {
    stock *= basePolicy.state === "restricted" ? 1.18 : 1.12;
    cadence *= basePolicy.state === "abundant" ? 0.95 : 0.9;
    priceMin *= 0.96;
    priceMax *= 0.92;
    headline = basePolicy.state === "restricted"
      ? "Essentials should be protected even under scarcity."
      : "Essentials should stay ahead of the pressure curve.";
  } else if (profile.lane === "luxury") {
    stock *= basePolicy.state === "abundant" ? 1.05 : 0.72;
    cadence *= basePolicy.state === "abundant" ? 1 : 1.2;
    priceMin *= basePolicy.state === "abundant" ? 1.02 : 1.08;
    priceMax *= basePolicy.state === "abundant" ? 1.08 : 1.18;
    headline = basePolicy.state === "abundant"
      ? "Luxury goods can ride surplus without owning it."
      : "Luxury goods should absorb scarcity before staples do.";
  } else if (profile.lane === "arcane") {
    stock *= basePolicy.state === "restricted" ? 0.88 : 0.97;
    cadence *= basePolicy.state === "abundant" ? 0.98 : 1.04;
    priceMin *= 1.01;
    priceMax *= 1.05;
    headline = "Arcane stock should stay viable with measured caution.";
  }

  stock = clampVendorNum(stock, 0.35, 1.5);
  cadence = clampVendorNum(cadence, 0.65, 1.75);
  priceMin = clampVendorNum(priceMin, 0.7, 1.4);
  priceMax = clampVendorNum(priceMax, 0.9, 2.25);
  if (priceMin > priceMax) {
    const lo = Math.min(priceMin, priceMax);
    const hi = Math.max(priceMin, priceMax);
    priceMin = lo;
    priceMax = hi;
  }

  return {
    ...basePolicy,
    lane: profile.lane,
    laneLabel: profile.label,
    laneDetail: profile.detail,
    recommendedStockMultiplier: stock,
    recommendedPriceMinMultiplier: priceMin,
    recommendedPriceMaxMultiplier: priceMax,
    recommendedRestockCadenceMultiplier: cadence,
    headline,
    detail,
    recommendedAction: action,
  };
}
