//web-backend/gameState/gameStateHeroes.ts

import type { Hero, HeroAttachment, HeroAttachmentKind, HeroAttachmentSlot, HeroGearFamily, HeroResponseRole, HeroRole, HeroTrait } from "../domain/heroes";
import type {
  GameEventInput,
  PlayerState,
  Resources,
} from "../gameState";

export interface HeroStateDeps {
  getPlayerState(playerId: string): PlayerState | undefined;
  tickPlayerState(ps: PlayerState, now: Date): void;
  pushEvent(ps: PlayerState, input: GameEventInput): void;
}

interface HeroAttachmentDef {
  name: string;
  slot: HeroAttachmentSlot;
  family: HeroGearFamily;
  responseTags: HeroResponseRole[];
  summary: string;
  powerBonus: number;
  wealthCost: number;
  manaCost: number;
  craftMaterialsCost: number;
  craftMinutes: number;
}

const HERO_ATTACHMENT_DEFS: Record<HeroAttachmentKind, HeroAttachmentDef> = {
  valor_charm: {
    name: "Valor Charm",
    slot: "trinket",
    family: "martial",
    responseTags: ["frontline", "recovery"],
    summary: "Martial ward-trinket that hardens frontline pushes and emergency stabilization.",
    powerBonus: 15,
    wealthCost: 60,
    manaCost: 0,
    craftMaterialsCost: 80,
    craftMinutes: 30,
  },
  scouting_cloak: {
    name: "Scouting Cloak",
    slot: "utility",
    family: "recon",
    responseTags: ["recon", "recovery"],
    summary: "Field cloak for scouts, pursuit, and early-warning response lanes.",
    powerBonus: 10,
    wealthCost: 45,
    manaCost: 10,
    craftMaterialsCost: 60,
    craftMinutes: 25,
  },
  arcane_focus: {
    name: "Arcane Focus",
    slot: "focus",
    family: "arcane",
    responseTags: ["warding", "command"],
    summary: "Arcane implement tuned for wards, anomalies, and organized spell response.",
    powerBonus: 18,
    wealthCost: 70,
    manaCost: 25,
    craftMaterialsCost: 90,
    craftMinutes: 40,
  },
};

export function getHeroAttachmentDef(kind: HeroAttachmentKind): HeroAttachmentDef | undefined {
  return HERO_ATTACHMENT_DEFS[kind];
}

export function createHeroAttachment(kind: HeroAttachmentKind, idSeed: number = Date.now()): HeroAttachment | null {
  const def = HERO_ATTACHMENT_DEFS[kind];
  if (!def) return null;
  return {
    id: `hgear_${idSeed}_${Math.floor(Math.random() * 100000)}` ,
    kind,
    name: def.name,
    slot: def.slot,
    family: def.family,
    responseTags: [...def.responseTags],
    summary: def.summary,
  };
}

type HeroWithGear = Hero & {
  level?: number;
  xp?: number;
  attachments?: HeroAttachment[];
};

interface HeroRecruitDef {
  namePool: string[];
  basePower: number;
  wealthCost: number;
  unityCost: number;
  responseRoles: HeroResponseRole[];
  positiveTraits: HeroTrait[];
  negativeTraits: HeroTrait[];
}

export interface WorkshopJob {
  id: string;
  attachmentKind: HeroAttachmentKind;
  startedAt: string;
  finishesAt: string;
  completed: boolean;
}

export interface EquipHeroAttachmentResult {
  status:
    | "ok"
    | "not_found"
    | "unknown_kind"
    | "insufficient_resources"
    | "already_has";
  message?: string;
  hero?: HeroWithGear;
  resources?: Resources;
}

export function equipHeroAttachmentForPlayer(
  deps: HeroStateDeps,
  playerId: string,
  heroId: string,
  kind: HeroAttachmentKind,
  now: Date
): EquipHeroAttachmentResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  const def = HERO_ATTACHMENT_DEFS[kind];
  if (!def) {
    return { status: "unknown_kind", message: "Unknown attachment kind" };
  }

  deps.tickPlayerState(ps, now);

  const hero = ps.heroes.find((h) => h.id === heroId) as HeroWithGear | undefined;
  if (!hero) {
    return { status: "not_found", message: "Hero not found" };
  }

  if (!hero.attachments) {
    hero.attachments = [];
  }

  if (hero.attachments.some((a) => a.kind === kind)) {
    return {
      status: "already_has",
      message: `${def.name} is already equipped on this hero.`,
      hero,
      resources: ps.resources,
    };
  }

  const slotConflict = hero.attachments.find((a) => a.slot === def.slot);
  if (slotConflict) {
    return {
      status: "already_has",
      message: `${hero.name} already has ${slotConflict.name} in the ${def.slot} slot.`,
      hero,
      resources: ps.resources,
    };
  }

  if (ps.resources.wealth < def.wealthCost || ps.resources.mana < def.manaCost) {
    return {
      status: "insufficient_resources",
      message: `Need ${def.wealthCost} wealth and ${def.manaCost} mana to equip ${def.name}.`,
    };
  }

  ps.resources.wealth -= def.wealthCost;
  ps.resources.mana -= def.manaCost;

  const attachment = createHeroAttachment(kind);
  if (!attachment) {
    return { status: "unknown_kind", message: "Unknown attachment kind" };
  }

  hero.attachments.push(attachment);
  hero.power += def.powerBonus;

  deps.pushEvent(ps, {
    kind: "hero_geared",
    message: `Equipped ${def.name} on ${hero.name}`,
    heroId: hero.id,
  });

  return {
    status: "ok",
    hero,
    resources: ps.resources,
  };
}

function pickHeroForAttachment(
  ps: PlayerState,
  kind: HeroAttachmentKind
): HeroWithGear | null {
  const list = ps.heroes as HeroWithGear[];
  const candidates = list.filter((h) => {
    const attachments = h.attachments ?? [];
    return !attachments.some((a) => a.kind === kind);
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.power - a.power);
  return candidates[0];
}

export interface StartWorkshopJobResult {
  status: "ok" | "not_found" | "unknown_kind" | "insufficient_resources";
  message?: string;
  job?: WorkshopJob;
  resources?: Resources;
}

export interface CompleteWorkshopJobResult {
  status:
    | "ok"
    | "not_found"
    | "not_ready"
    | "no_hero_available"
    | "already_completed";
  message?: string;
  job?: WorkshopJob;
  hero?: HeroWithGear;
  resources?: Resources;
}

export function startWorkshopJobForPlayer(
  deps: HeroStateDeps,
  playerId: string,
  kind: HeroAttachmentKind,
  now: Date
): StartWorkshopJobResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  const def = HERO_ATTACHMENT_DEFS[kind];
  if (!def) {
    return {
      status: "unknown_kind",
      message: "Unknown attachment kind",
    };
  }

  deps.tickPlayerState(ps, now);

  const r = ps.resources;
  const materialsCost = def.craftMaterialsCost;
  const wealthCost = Math.round(def.wealthCost * 0.4);
  const manaCost = def.manaCost;

  if (r.materials < materialsCost || r.wealth < wealthCost || r.mana < manaCost) {
    return {
      status: "insufficient_resources",
      message: `Need ${materialsCost} materials, ${wealthCost} wealth and ${manaCost} mana to start crafting ${def.name}.`,
    };
  }

  r.materials -= materialsCost;
  r.wealth -= wealthCost;
  r.mana -= manaCost;

  const startedAt = now.toISOString();
  const finishesAt = new Date(
    now.getTime() + def.craftMinutes * 60 * 1000
  ).toISOString();

  const job: WorkshopJob = {
    id: `craft_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    attachmentKind: kind,
    startedAt,
    finishesAt,
    completed: false,
  };

  ps.workshopJobs.push(job);

  deps.pushEvent(ps, {
    kind: "workshop_start",
    message: `Started crafting ${def.name} in the workshop.`,
  });

  return {
    status: "ok",
    job,
    resources: ps.resources,
  };
}

export function completeWorkshopJobForPlayer(
  deps: HeroStateDeps,
  playerId: string,
  jobId: string,
  now: Date
): CompleteWorkshopJobResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  deps.tickPlayerState(ps, now);

  const job = ps.workshopJobs.find((j) => j.id === jobId);
  if (!job) {
    return {
      status: "not_found",
      message: "Workshop job not found",
    };
  }

  if (job.completed) {
    return {
      status: "already_completed",
      message: "Job already completed.",
      job,
      resources: ps.resources,
    };
  }

  if (now.getTime() < new Date(job.finishesAt).getTime()) {
    return {
      status: "not_ready",
      message: "Crafting is still in progress.",
      job,
      resources: ps.resources,
    };
  }

  const def = HERO_ATTACHMENT_DEFS[job.attachmentKind];
  if (!def) {
    job.completed = true;
    return {
      status: "ok",
      message: "Attachment definition missing; marking job complete.",
      job,
      resources: ps.resources,
    };
  }

  const hero = pickHeroForAttachment(ps, job.attachmentKind);
  if (!hero) {
    job.completed = true;
    deps.pushEvent(ps, {
      kind: "workshop_complete",
      message: `Crafted ${def.name}, but no suitable hero was available.`,
    });
    return {
      status: "no_hero_available",
      message: "No hero available to equip this item.",
      job,
      resources: ps.resources,
    };
  }

  if (!hero.attachments) {
    hero.attachments = [];
  }

  const attachment = createHeroAttachment(job.attachmentKind);
  if (!attachment) {
    job.completed = true;
    return {
      status: "ok",
      message: "Attachment definition missing; marking job complete.",
      job,
      resources: ps.resources,
    };
  }

  const slotConflict = hero.attachments.find((a) => a.slot === attachment.slot);
  if (slotConflict) {
    job.completed = true;
    deps.pushEvent(ps, {
      kind: "workshop_complete",
      message: `Crafted ${attachment.name}, but ${hero.name} already had the ${attachment.slot} slot filled.`,
      heroId: hero.id,
    });
    return {
      status: "no_hero_available",
      message: `${hero.name} already has the ${attachment.slot} slot filled.`,
      job,
      hero,
      resources: ps.resources,
    };
  }

  hero.attachments.push(attachment);
  hero.power += def.powerBonus;
  job.completed = true;

  deps.pushEvent(ps, {
    kind: "hero_geared",
    message: `Workshop completed: equipped ${def.name} on ${hero.name}.`,
    heroId: hero.id,
  });
  deps.pushEvent(ps, {
    kind: "workshop_complete",
    message: `Workshop job finished: ${def.name}.`,
  });

  return {
    status: "ok",
    job,
    hero,
    resources: ps.resources,
  };
}

export interface RecruitHeroResult {
  status:
    | "ok"
    | "not_found"
    | "invalid_role"
    | "insufficient_resources";
  message?: string;
  hero?: Hero;
  resources?: Resources;
}

interface HeroRecruitDef {
  namePool: string[];
  basePower: number;
  wealthCost: number;
  unityCost: number;
}

const HERO_RECRUIT_DEFS: Record<HeroRole, HeroRecruitDef> = {
  champion: {
    namePool: [
      "Steelbound Vanguard",
      "The Unbroken Shield",
      "Crimson Bulwark",
      "Stormwall Captain",
    ],
    basePower: 75,
    wealthCost: 150,
    unityCost: 10,
    responseRoles: ["frontline", "recovery"],
    positiveTraits: [
      { id: "steadfast", name: "Steadfast", polarity: "pro", summary: "+Frontline staying power during hard fights.", responseBias: { frontline: 18 }, injuryDelta: -0.08 },
      { id: "battle_scarred", name: "Battle-Scarred", polarity: "pro", summary: "Knows how to keep fighting through ugly attrition.", responseBias: { frontline: 8, recovery: 4 }, powerDelta: 2 },
    ],
    negativeTraits: [
      { id: "rigid", name: "Rigid", polarity: "con", summary: "Less adaptable outside direct battle lines.", responseBias: { command: -10, recon: -8 } },
      { id: "cautious", name: "Cautious", polarity: "con", summary: "Hesitates when a response needs reckless initiative.", responseBias: { frontline: -4 } },
    ],
  },
  scout: {
    namePool: [
      "Whisperstep Ranger",
      "Veiled Pathfinder",
      "Shadowrunner",
      "Silent Arrow",
    ],
    basePower: 55,
    wealthCost: 110,
    unityCost: 7,
    responseRoles: ["recon", "recovery"],
    positiveTraits: [
      { id: "swift", name: "Swift", polarity: "pro", summary: "+Better for reconnaissance, pursuit, and warning response.", responseBias: { recon: 18, recovery: 6 } },
      { id: "cautious", name: "Cautious", polarity: "pro", summary: "Keeps ahead of ambushes and avoids needless exposure.", responseBias: { recon: 8, warding: 4 }, injuryDelta: -0.03 },
    ],
    negativeTraits: [
      { id: "fragile", name: "Fragile", polarity: "con", summary: "Struggles in prolonged attrition fights.", injuryDelta: 0.08, responseBias: { frontline: -12 } },
      { id: "rigid", name: "Rigid", polarity: "con", summary: "Poor at adapting to command-heavy battlefield pivots.", responseBias: { command: -8 } },
    ],
  },
  tactician: {
    namePool: [
      "Battlefield Architect",
      "Lineshaper",
      "Warroom Savant",
      "Frontline Marshal",
    ],
    basePower: 60,
    wealthCost: 130,
    unityCost: 9,
    responseRoles: ["command", "recovery"],
    positiveTraits: [
      { id: "inspiring", name: "Inspiring", polarity: "pro", summary: "+Improves organized responses and recovery coordination.", responseBias: { command: 18, recovery: 10 } },
      { id: "steadfast", name: "Steadfast", polarity: "pro", summary: "Keeps a response plan intact under pressure.", responseBias: { command: 8, frontline: 4 } },
    ],
    negativeTraits: [
      { id: "cautious", name: "Cautious", polarity: "con", summary: "May surrender tempo when a crisis rewards speed.", responseBias: { frontline: -6 } },
      { id: "fragile", name: "Fragile", polarity: "con", summary: "Not built for direct duels when plans collapse.", responseBias: { frontline: -10 }, injuryDelta: 0.04 },
    ],
  },
  mage: {
    namePool: [
      "Ember Sigilist",
      "Aetherbinder",
      "Stormcall Arcanist",
      "Gloamfire Occultist",
    ],
    basePower: 70,
    wealthCost: 140,
    unityCost: 8,
    responseRoles: ["warding", "command"],
    positiveTraits: [
      { id: "planar_savvy", name: "Planar Savvy", polarity: "pro", summary: "+Better against strange incursions, wards, and arcane disturbances.", responseBias: { warding: 20, command: 4 } },
      { id: "inspiring", name: "Inspiring", polarity: "pro", summary: "Turns arcane mastery into organized city response.", responseBias: { command: 8, warding: 6 } },
    ],
    negativeTraits: [
      { id: "fragile", name: "Fragile", polarity: "con", summary: "Breaks down faster in prolonged attrition.", injuryDelta: 0.08, responseBias: { frontline: -10 } },
      { id: "battle_scarred", name: "Battle-Scarred", polarity: "con", summary: "Old wounds flare during extended crises.", injuryDelta: 0.04 },
    ],
  },
};

function pickRecruitTraits(def: HeroRecruitDef, seedIndex: number): HeroTrait[] {
  const pos = def.positiveTraits[seedIndex % def.positiveTraits.length];
  const neg = def.negativeTraits[(seedIndex + 1) % def.negativeTraits.length];
  return [pos, neg].map((trait) => ({ ...trait, responseBias: trait.responseBias ? { ...trait.responseBias } : undefined }));
}

function pickHeroName(role: HeroRole, index: number): string {
  const def = HERO_RECRUIT_DEFS[role];
  if (!def) return `Unknown ${role}`;
  const pool = def.namePool;
  if (pool.length === 0) return `Nameless ${role}`;
  return pool[index % pool.length];
}

export function recruitHeroForPlayer(
  deps: HeroStateDeps,
  playerId: string,
  role: HeroRole,
  now: Date
): RecruitHeroResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  const def = HERO_RECRUIT_DEFS[role];
  if (!def) {
    return { status: "invalid_role", message: "Invalid hero role" };
  }

  deps.tickPlayerState(ps, now);

  const r = ps.resources;
  if (r.wealth < def.wealthCost || r.unity < def.unityCost) {
    return {
      status: "insufficient_resources",
      message: `Need ${def.wealthCost} wealth and ${def.unityCost} unity to recruit this hero.`,
    };
  }

  r.wealth -= def.wealthCost;
  r.unity -= def.unityCost;

  const index = ps.heroes.length + 1;
  const name = pickHeroName(role, index);
  const tier = ps.city.tier ?? 1;
  const variance = Math.floor(Math.random() * 11) - 5;
  const power = def.basePower + tier * 5 + variance;

  const traits = pickRecruitTraits(def, index);
  const traitPowerDelta = traits.reduce((sum, trait) => sum + (trait.powerDelta ?? 0), 0);

  const hero: Hero = {
    id: `hero_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    ownerId: ps.playerId,
    name,
    role,
    responseRoles: [...def.responseRoles],
    traits,
    power: power + traitPowerDelta,
    tags: traits.map((trait) => trait.id),
    status: "idle",
  };

  ps.heroes.push(hero);

  deps.pushEvent(ps, {
    kind: "hero_recruited",
    message: `Recruited ${hero.name} (${hero.role})`,
    heroId: hero.id,
  });

  return {
    status: "ok",
    hero,
    resources: ps.resources,
  };
}
