// worldcore/test/contract_townQuestGenerator_rotation_fairness_shapes_v0_26.test.ts
//
// Generator v0.26: rotation fairness expands beyond quest ids.
//
// This is a *soft* contract: when the caller provides "recently offered" shape hints
// (objective signatures / resource families), the generator should *tend* to prefer
// alternatives when the pool provides them, while remaining deterministic and underfill-safe.
//
// IMPORTANT: This test uses extraCandidates to create a controlled pool of alternatives.
// We assert a relative preference shift compared to baseline, rather than demanding a
// specific quest id always appear (the generator is still allowed to pick from core pools).

import test from "node:test";
import assert from "node:assert/strict";

import { generateTownQuests } from "../quests/QuestGenerator";

function isSticky(qid: any): boolean {
  const s = String(qid ?? "");
  return s.endsWith("greet_quartermaster") || s.endsWith("rat_culling");
}

function objectiveSignature(q: any): string {
  const kinds = Array.isArray(q?.objectives)
    ? q.objectives.map((o: any) => String(o?.kind ?? "")).filter(Boolean)
    : [];
  return `sig:${kinds.join("+")}`;
}

function resourceFamilies(q: any): string[] {
  const fams = new Set<string>();
  const objs = Array.isArray(q?.objectives) ? q.objectives : [];
  for (const o of objs) {
    const kind = String(o?.kind ?? "");
    if (kind === "harvest" || kind === "vein_report") {
      const node = String(o?.nodeProtoId ?? o?.veinProtoId ?? o?.resourceProtoId ?? "");
      const fam = node.split("_")[0];
      if (fam) fams.add(`resfam:${fam}`);
    }
    if (kind === "collect_item") {
      const item = String(o?.itemId ?? "");
      const fam = item.split("_")[0];
      if (fam) fams.add(`resfam:${fam}`);
    }
  }
  return [...fams.values()];
}

function countBy<T>(arr: T[], pred: (t: T) => boolean): number {
  let n = 0;
  for (const x of arr) if (pred(x)) n++;
  return n;
}

// Build a deterministic pool of alternatives via extraCandidates.
// We deliberately include both "harvest" and "collect_item" single-objective quests,
// plus multiple families (herb/wood/ore), so the generator has real choices.
function buildExtraCandidates() {
  const mk = (def: any) => () => def;

  // Single-objective signatures
  const harvestHerb = mk({
    id: "contract_v026_harvest_herb",
    name: "Contract: Harvest Herb",
    description: "Gather a small sample of herbs.",
    minLevel: 1,
    objectives: [{ kind: "harvest", nodeProtoId: "herb_peacebloom", count: 1 }],
    rewards: [],
    isRepeatable: true,
  });

  const harvestOre = mk({
    id: "contract_v026_harvest_ore",
    name: "Contract: Harvest Ore",
    description: "Gather a small sample of ore.",
    minLevel: 1,
    objectives: [{ kind: "harvest", nodeProtoId: "ore_vein_small", count: 1 }],
    rewards: [],
    isRepeatable: true,
  });

  const collectWood = mk({
    id: "contract_v026_collect_wood",
    name: "Contract: Collect Wood",
    description: "Bring back a small bundle of wood.",
    minLevel: 1,
    objectives: [{ kind: "collect_item", itemId: "wood_oak", count: 1 }],
    rewards: [],
    isRepeatable: true,
  });

  const collectHerb = mk({
    id: "contract_v026_collect_herb",
    name: "Contract: Collect Herb",
    description: "Bring back a small bundle of herbs.",
    minLevel: 1,
    objectives: [{ kind: "collect_item", itemId: "herb_peacebloom", count: 1 }],
    rewards: [],
    isRepeatable: true,
  });

  // Add a few duplicates to ensure the pool has ample alternatives
  // without depending on core pools.
  return [
    harvestHerb,
    harvestOre,
    collectWood,
    collectHerb,
    harvestOre,
    collectWood,
    harvestHerb,
    collectWood,
  ];
}

test("[contract] town quest generator v0.26: recently-offered objective signatures are deprioritized (soft)", () => {
  const base = generateTownQuests({
    townId: "prime_shard:0,0",
    tier: 2,
    epoch: "2026-W03",
    maxQuests: 6,
    includeRepeatables: true,
    includeChainCatalog: false,
    extraCandidates: buildExtraCandidates(),
  });

  const shifted = generateTownQuests({
    townId: "prime_shard:0,0",
    tier: 2,
    epoch: "2026-W03",
    maxQuests: 6,
    includeRepeatables: true,
    includeChainCatalog: false,
    // Treat single-objective harvest as "recently offered".
    recentlyOfferedObjectiveSignatures: ["sig:harvest"],
    extraCandidates: buildExtraCandidates(),
  } as any);

  const baseNonSticky = base.filter((q) => !isSticky(q.id));
  const shiftedNonSticky = shifted.filter((q) => !isSticky(q.id));

  const baseHarvestCount = countBy(baseNonSticky, (q) => objectiveSignature(q) === "sig:harvest");
  const shiftedHarvestCount = countBy(shiftedNonSticky, (q) => objectiveSignature(q) === "sig:harvest");

  // Soft expectation: if the baseline contains harvest-only quests, the "recent harvest" run
  // should not increase that count, and should usually reduce it when alternatives exist.
  assert.ok(
    shiftedHarvestCount <= baseHarvestCount,
    `Expected recent-harvest run to not increase harvest-only count; base=${baseHarvestCount} shifted=${shiftedHarvestCount} baseIds=${base.map((q) => q.id).join(", ")} shiftedIds=${shifted
      .map((q) => q.id)
      .join(", ")}`,
  );
});

test("[contract] town quest generator v0.26: recently-offered resource families are deprioritized (soft)", () => {
  const base = generateTownQuests({
    townId: "prime_shard:0,0",
    tier: 2,
    epoch: "2026-W03",
    maxQuests: 6,
    includeRepeatables: true,
    includeChainCatalog: false,
    extraCandidates: buildExtraCandidates(),
  });

  const shifted = generateTownQuests({
    townId: "prime_shard:0,0",
    tier: 2,
    epoch: "2026-W03",
    maxQuests: 6,
    includeRepeatables: true,
    includeChainCatalog: false,
    // Treat herb family as recently offered.
    recentlyOfferedResourceFamilies: ["resfam:herb"],
    extraCandidates: buildExtraCandidates(),
  } as any);

  const baseNonSticky = base.filter((q) => !isSticky(q.id));
  const shiftedNonSticky = shifted.filter((q) => !isSticky(q.id));

  const baseHerbCount = countBy(baseNonSticky, (q) => resourceFamilies(q).includes("resfam:herb"));
  const shiftedHerbCount = countBy(shiftedNonSticky, (q) => resourceFamilies(q).includes("resfam:herb"));

  // Soft expectation: a "recent herb" hint should not increase herb-family picks, and should
  // usually reduce them when non-herb alternatives exist.
  assert.ok(
    shiftedHerbCount <= baseHerbCount,
    `Expected recent-herb run to not increase herb-family count; base=${baseHerbCount} shifted=${shiftedHerbCount} baseIds=${base.map((q) => q.id).join(", ")} shiftedIds=${shifted
      .map((q) => q.id)
      .join(", ")}`,
  );
});
