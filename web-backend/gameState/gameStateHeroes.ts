//web-backend/gameState/gameStateHeroes.ts

import type { Hero, HeroRole } from "../domain/heroes";
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

export type HeroAttachmentKind =
  | "valor_charm"
  | "scouting_cloak"
  | "arcane_focus";

export interface HeroAttachment {
  id: string;
  kind: HeroAttachmentKind;
  name: string;
}

interface HeroAttachmentDef {
  name: string;
  powerBonus: number;
  wealthCost: number;
  manaCost: number;
  craftMaterialsCost: number;
  craftMinutes: number;
}

const HERO_ATTACHMENT_DEFS: Record<HeroAttachmentKind, HeroAttachmentDef> = {
  valor_charm: {
    name: "Valor Charm",
    powerBonus: 15,
    wealthCost: 60,
    manaCost: 0,
    craftMaterialsCost: 80,
    craftMinutes: 30,
  },
  scouting_cloak: {
    name: "Scouting Cloak",
    powerBonus: 10,
    wealthCost: 45,
    manaCost: 10,
    craftMaterialsCost: 60,
    craftMinutes: 25,
  },
  arcane_focus: {
    name: "Arcane Focus",
    powerBonus: 18,
    wealthCost: 70,
    manaCost: 25,
    craftMaterialsCost: 90,
    craftMinutes: 40,
  },
};

type HeroWithGear = Hero & {
  level?: number;
  xp?: number;
  attachments?: HeroAttachment[];
};

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

  if (ps.resources.wealth < def.wealthCost || ps.resources.mana < def.manaCost) {
    return {
      status: "insufficient_resources",
      message: `Need ${def.wealthCost} wealth and ${def.manaCost} mana to equip ${def.name}.`,
    };
  }

  ps.resources.wealth -= def.wealthCost;
  ps.resources.mana -= def.manaCost;

  const attachment: HeroAttachment = {
    id: `hgear_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    kind,
    name: def.name,
  };

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

  const attachment: HeroAttachment = {
    id: `hgear_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    kind: job.attachmentKind,
    name: def.name,
  };

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
  },
};

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

  const hero: Hero = {
    id: `hero_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    ownerId: ps.playerId,
    name,
    role,
    power,
    tags: [],
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
