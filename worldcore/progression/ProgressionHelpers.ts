// worldcore/progression/ProgressionHelpers.ts

import { CharacterProgression, PowerResourceState, CooldownsState, SkillsState,
        GatheringState, } from "./ProgressionTypes";
  
  /**
   * Ensure the progression blob is at least a sane object.
   * Use this when loading characters.
   */
  export function normalizeProgression(raw: any | null | undefined): CharacterProgression {
    if (!raw || typeof raw !== "object") {
      return {};
    }
    // Shallow copy to avoid mutating the original reference if caller doesn't expect it.
    const prog: CharacterProgression = { ...raw };
  
    // Ensure top-level maps are objects when present.
    if (prog.powerResources && typeof prog.powerResources !== "object") {
      prog.powerResources = {};
    }
    if (prog.cooldowns && typeof prog.cooldowns !== "object") {
      prog.cooldowns = {};
    }
    if (prog.skills && typeof prog.skills !== "object") {
      prog.skills = {};
    }
    if (prog.gathering && typeof prog.gathering !== "object") {
      prog.gathering = {};
    }
    if (prog.counters && typeof prog.counters !== "object") {
      prog.counters = {};
    }
    if (prog.flags && typeof prog.flags !== "object") {
      prog.flags = {};
    }
  
    return prog;
  }
  
  // ----- Power resources (mana, fury, etc.) -----
  
  export function getOrInitPowerResource(
    prog: CharacterProgression,
    key: string,
    defaultMax: number
  ): PowerResourceState {
    if (!prog.powerResources) {
      prog.powerResources = {};
    }
  
    const pool = prog.powerResources;
    const existing = pool[key];
  
    if (existing && typeof existing.current === "number" && typeof existing.max === "number") {
      return existing;
    }
  
    const fresh: PowerResourceState = {
      current: defaultMax,
      max: defaultMax,
    };
    pool[key] = fresh;
    return fresh;
  }
  
  export function modifyPowerResource(
    prog: CharacterProgression,
    key: string,
    delta: number,
    defaultMax: number
  ): PowerResourceState {
    const res = getOrInitPowerResource(prog, key, defaultMax);
    const max = res.max > 0 ? res.max : defaultMax;
    let next = res.current + delta;
  
    if (next < 0) next = 0;
    if (next > max) next = max;
  
    res.current = next;
    res.max = max;
    return res;
  }
  
  // ----- Cooldowns -----
  
  export function getCooldowns(prog: CharacterProgression): CooldownsState {
    if (!prog.cooldowns) {
      prog.cooldowns = {};
    }
    return prog.cooldowns!;
  }
  
  export function isAbilityOnCooldown(
    prog: CharacterProgression,
    abilityId: string,
    nowMs: number
  ): boolean {
    const cds = prog.cooldowns;
    const entry = cds?.abilities?.[abilityId];
    if (!entry) return false;
    return entry.readyAt > nowMs;
  }
  
  export function setAbilityCooldown(
    prog: CharacterProgression,
    abilityId: string,
    readyAt: number
  ): void {
    const cds = getCooldowns(prog);
    if (!cds.abilities) cds.abilities = {};
    cds.abilities[abilityId] = { readyAt };
  }
  
  // ----- Skills -----
  
  export function getSkills(prog: CharacterProgression): SkillsState {
    if (!prog.skills) {
      prog.skills = {};
    }
    return prog.skills!;
  }
  
  export function getOrInitSkillBucket(
    prog: CharacterProgression,
    bucketKey: keyof SkillsState
  ): Record<string, number> {
    const skills = getSkills(prog);
    if (!skills[bucketKey]) {
      (skills as any)[bucketKey] = {};
    }
    return (skills as any)[bucketKey];
  }
  
  // ----- Gathering -----
  
  export function getGathering(prog: CharacterProgression): GatheringState {
    if (!prog.gathering) {
      prog.gathering = {};
    }
    return prog.gathering!;
  }
  
  export function getOrInitGatherDiscipline(
    prog: CharacterProgression,
    discipline: string
  ): { nodesGathered?: number } {
    const g = getGathering(prog);
    if (!g[discipline]) {
      g[discipline] = {};
    }
    return g[discipline]!;
  }
  