// worldcore/combat/NpcCombat.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";
import { Logger } from "../utils/logger";
import { getNpcPrototype } from "../npc/NpcTypes";
import { getAssistTargetForAlly } from "../npc/NpcThreat";
import {
  isServiceProtectedNpcProto,
  serviceProtectedCombatLine,
} from "./ServiceProtection";
import { serviceProtectionGate, canDamage } from "./DamagePolicy";
import {
  markInCombat,
  isDeadEntity,
  applySimpleDamageToPlayer,
  computeNpcMeleeDamage,
} from "./entityCombat";
import { describeLootLine } from "../loot/lootText";
import { deliverItemToBagsOrMail } from "../loot/OverflowDelivery";
import { rollInt } from "../utils/random";
import {
  computeDamage,
  type CombatSource,
  type CombatTarget,
  type WeaponSkillId,
  type SpellSchoolId,
} from "./CombatEngine";
import { computeEntityCombatStatusSnapshot, clearAllStatusEffectsFromEntity, getActiveStatusEffectsForEntity } from "./StatusEffects";
import { formatWorldSpellDirectDamageLine } from "./CombatLog";
import type { AttackChannel } from "../actions/ActionTypes";
import {
  gainPowerResource,
  getPrimaryPowerResourceForClass,
} from "../resources/PowerResources";
import {
  gainWeaponSkill,
  gainSpellSchoolSkill,
  gainSongSchoolSkill,
  gainDefenseSkill,
  getWeaponSkill,
  getDefenseSkill,
  type SongSchoolId,
} from "../skills/SkillProgression";
import { computeEffectiveAttributes } from "../characters/Stats";
import { getProfileDamageMult } from "../pets/PetProfiles";
import { collectItemProcsFromGear, getPetGearDamageMult, type ItemProcDef } from "../pets/PetGear";
import { getSpawnPoint } from "../world/SpawnPointCache";
import { resolvePhysicalHit } from "./PhysicalHitResolver";
import { computeWeaponSkillGainOnSwingAttempt, getWeaponSkillCapPoints } from "./CombatScaling";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

// --- Pet item proc hooks (v1) ----------------------------------------------
// Pets can wear normal gear, and gear may define simple proc payloads.
// We keep proc processing conservative and best-effort.

function rng01(opts: any): number {
  try {
    const r = typeof opts?.rng === "function" ? opts.rng() : Math.random();
    if (!Number.isFinite(r)) return Math.random();
    // normalize to [0,1)
    return Math.max(0, Math.min(0.999999999, r));
  } catch {
    return Math.random();
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function getProcKey(p: ItemProcDef, idx: number): string {
  return String(p.id ?? p.name ?? `proc_${idx}`);
}

function isProcReady(pet: any, key: string, now: number): boolean {
  const map: any = (pet as any)._pwProcCd ?? ((pet as any)._pwProcCd = {});
  const readyAt = Number(map[key] ?? 0);
  return !Number.isFinite(readyAt) || readyAt <= now;
}

function setProcCooldown(pet: any, key: string, now: number, icdMs: number | undefined): void {
  const ms = Number(icdMs ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return;
  const map: any = (pet as any)._pwProcCd ?? ((pet as any)._pwProcCd = {});
  map[key] = now + ms;
}

async function tryTriggerPetOnHitProcs(
  ctx: SimpleCombatContext,
  ownerChar: CharacterState,
  petEntity: any,
  targetNpc: Entity,
  opts: any,
): Promise<{ extraDamage: number; snippets: string[]; newHp?: number } | null> {
  try {
    if (!ctx?.npcs) return null;
    if (!petEntity || petEntity.type !== "pet") return null;
    if (!petEntity.equipment) return null;

    const procs = collectItemProcsFromGear(petEntity, (ctx as any).items);
    if (!procs || procs.length === 0) return null;

    const now = Date.now();
    let extraDamage = 0;
    const snippets: string[] = [];

    for (let i = 0; i < procs.length; i++) {
      const p = procs[i];
      const trig = String(p.trigger ?? "on_hit").toLowerCase();
      if (trig !== "on_hit") continue;

      const chance = clamp01(Number(p.chance ?? 0));
      if (chance <= 0) continue;

      const key = getProcKey(p, i);
      if (!isProcReady(petEntity, key, now)) continue;

      if (rng01(opts) > chance) continue;

      const dmg = Math.max(0, Math.floor(Number(p.damage ?? 0)));
      if (dmg <= 0) {
        // No-op proc in v1
        setProcCooldown(petEntity, key, now, p.icdMs);
        continue;
      }

      // Apply proc damage through NpcManager so death pipeline stays consistent.
      const prevHp = (targetNpc as any).hp ?? (targetNpc as any).maxHp ?? 1;
      const appliedHp = ctx.npcs.applyDamage(targetNpc.id, dmg, {
        character: ownerChar,
        entityId: String(petEntity.id),
        tag: "pet_proc",
      });

      let afterHp = Math.max(0, prevHp - dmg);
      if (typeof appliedHp === "number") afterHp = appliedHp;
      else (targetNpc as any).hp = afterHp;

      extraDamage += dmg;
      const name = String(p.name ?? "Proc");
      snippets.push(`[proc:${name}] hits for ${dmg}`);

      setProcCooldown(petEntity, key, now, p.icdMs);
    }

    if (extraDamage <= 0 || snippets.length === 0) return null;
    const newHp = (targetNpc as any).hp;
    return { extraDamage, snippets, newHp };
  } catch {
    return null;
  }
}


function getDefenderLevel(ctx: any, npc: Entity): number {
  const n: any = npc as any;
  if (typeof n.level === "number" && n.level > 0) return Math.floor(n.level);

  try {
    if (ctx?.npcs) {
      const st = ctx.npcs.getNpcStateByEntityId(npc.id);
      if (st) {
        const proto = getNpcPrototype(st.templateId) ?? getNpcPrototype(st.protoId);
        const lvl = (proto as any)?.level;
        if (typeof lvl === "number" && lvl > 0) return Math.floor(lvl);
      }
    }
  } catch {
    // ignore
  }

  return 1;
}
const log = Logger.scope("NPC_COMBAT");

type SimpleCombatContext = {
  [key: string]: any;
  npcs?: any;
  entities?: any;
  items?: any;
  session?: any;
  characters?: any;
  mail?: any;
  rooms?: any;
};

export interface NpcAttackOptions {
  abilityName?: string;
  damageMultiplier?: number;
  flatBonus?: number;
  tagPrefix?: string; // "ability" | "spell" etc.

  channel?: AttackChannel; // default: "weapon"
  weaponSkill?: WeaponSkillId;
  spellSchool?: SpellSchoolId;

  // For Virtuoso songs
  songSchool?: SongSchoolId;
  isSong?: boolean;


  // Deterministic RNG injection for contract tests
  rng?: () => number;
}

/**
 * Shared high-level NPC attack executor.
 *
 * - Uses CombatEngine to compute damage
 * - Handles skill/resource progression for the attacker
 * - Applies simple NPC counter-attack
 * - Awards XP + loot and schedules respawn on kill
 *
 * Returns a human-readable combat line for MUD output.
 */

async function finalizeNpcKillAndRewards(
  ctx: SimpleCombatContext,
  char: CharacterState,
  selfEntity: Entity,
  npc: Entity,
  line: string,
): Promise<string> {
  // --- NPC death: XP + loot ---
    (npc as any).alive = false;

    // Death clears combat status effects (DOTs/debuffs) so corpses don't keep ticking.
    try {
      clearAllStatusEffectsFromEntity(npc as any);
    } catch {
      // ignore
    }

    // Notify room listeners immediately (corpse state / client visuals / post-kill actions).
    // Safe no-op if the client ignores entity_update.
    try {
      const st = ctx.npcs?.getNpcStateByEntityId(npc.id);
      const rid = st?.roomId ?? (npc as any)?.roomId;
      const room = rid ? ctx.rooms?.get(rid) : undefined;
      room?.broadcast("entity_update", {
        id: npc.id,
        hp: 0,
        maxHp: (npc as any)?.maxHp ?? 1,
        alive: false,
      });
    } catch {
      // ignore
    }
    line += ` You slay ${npc.name}!`;

    // Resolve prototype for rewards
    let xpReward = 10;
    let lootEntries:
      | {
          itemId: string;
          chance: number;
          minQty: number;
          maxQty: number;
        }[]
      | [] = [];

    try {
      if (ctx.npcs) {
        const npcState = ctx.npcs.getNpcStateByEntityId(npc.id);
        if (npcState) {
          const proto = getNpcPrototype(npcState.protoId);
          if (proto) {
            if (typeof proto.xpReward === "number") {
              xpReward = proto.xpReward;
            } else if (typeof proto.level === "number") {
              xpReward = 5 + proto.level * 3;
            }
            if (proto.loot && proto.loot.length > 0) {
              lootEntries = proto.loot;
            }
          }
        }
      }
    } catch (err) {
      log.warn("Error resolving NPC prototype for rewards", {
        err,
        npcId: npc.id,
        npcName: npc.name,
      });
    }

    // --- XP reward (same pattern as debug_xp) ---
    if (ctx.characters) {
      const userId = ctx.session.identity?.userId;
      if (userId) {
        try {
          const updated = await ctx.characters.grantXp(userId, char.id, xpReward);
          if (updated) {
            ctx.session.character = updated;
            char.level = updated.level;
            char.xp = updated.xp;
            char.attributes = updated.attributes;
            line += ` You gain ${xpReward} XP.`;
          }
        } catch (err) {
          log.warn("grantXp from NPC kill failed", {
            err,
            charId: char.id,
            npc: npc.name,
          });
        }
      }
    }

    // --- Loot reward (same behavior as before) ---
    const lootLines: string[] = [];
    const inventory = char.inventory;

    if (lootEntries.length > 0) {
      for (const entry of lootEntries) {
        const r = Math.random();
        if (r > entry.chance) continue;

        const qty = rollInt(entry.minQty, entry.maxQty);
        if (qty <= 0) continue;

        const res = await deliverItemToBagsOrMail(
          { items: ctx.items, mail: ctx.mail, session: ctx.session },
          {
            itemId: entry.itemId,
            qty,
            inventory,
            ownerKind: "account",
            sourceName: npc.name,
            sourceVerb: "looting",
            mailSubject: "Overflow loot",
          },
        );

        if (res.added <= 0 && res.mailed <= 0 && res.leftover > 0) {
          log.warn("Loot delivery failed; dropping overflow", {
            itemId: entry.itemId,
            npc: npc.name,
            qty,
            leftover: res.leftover,
          });
          continue;
        }

        if (res.added > 0) {
          lootLines.push(describeLootLine(res.itemId, res.added, res.name));
        }
        if (res.mailed > 0) {
          lootLines.push(describeLootLine(res.itemId, res.mailed, res.name) + " (via mail)");
        }
      }

      if (lootLines.length > 0) {
        ctx.session.character = char;
        if (ctx.characters) {
          try {
            await ctx.characters.saveCharacter(char);
          } catch (err) {
            log.warn("Failed to save character after loot", {
              err,
              charId: char.id,
            });
          }
        }

        line += ` You loot ${lootLines.join(", ")}.`;
      }
    }

    // Corpse + respawn handling (unchanged behavior)
    scheduleNpcCorpseAndRespawn(ctx, npc.id);

  return line;
}

export async function performNpcAttack(
  ctx: SimpleCombatContext,
  char: CharacterState,
  selfEntity: Entity,
  npc: Entity,
  opts: NpcAttackOptions = {},
): Promise<string> {
  // --- Damage policy: prevent bypassing region combatEnabled / service protection rules. ---
  // (Contract test asserts NPC combat consults DamagePolicy.canDamage.)
  try {
    const regionId =
      ((selfEntity as any)?.roomId as string | undefined) ??
      ((npc as any)?.roomId as string | undefined);

    // If regionId is missing for some reason, allow combat (best-effort).
    if (regionId) {
      const policy = await canDamage(
        { char },
        { entity: npc },
        { shardId: char.shardId, regionId },
      );

      if (policy && policy.allowed === false) {
        return policy.reason ?? "You cannot attack here.";
      }
    }
  } catch {
    // Best-effort: never let policy lookup crash combat.
    // (In tests, WORLDCORE_TEST=1 disables DB-backed region flags anyway.)
  }

  // --- Service-provider protection: bankers/auctioneers/mailboxes etc are immune. ---
  try {
    const svc = serviceProtectionGate(npc);
    if (svc && !svc.allowed) {
      return svc.reason;
    }

    if (ctx.npcs) {
      const st = ctx.npcs.getNpcStateByEntityId(npc.id);
      const proto = st
        ? getNpcPrototype(st.templateId) ?? getNpcPrototype(st.protoId)
        : null;

      if (isServiceProtectedNpcProto(proto)) {
        // Cache a runtime flag too, so other systems can short-circuit without a proto lookup.
        (npc as any).invulnerable = true;
        (npc as any).isServiceProvider = true;
        return serviceProtectedCombatLine(npc.name);
      }
    }
  } catch {
    // Best-effort; fall through to normal combat on failure.
  }

  // --- Build combat source/target for CombatEngine ---
  const itemService = ctx.items;
  const effective = computeEffectiveAttributes(char, itemService);

  const source: CombatSource = {
    char,
    effective,
    channel: opts.channel ?? "weapon",
    weaponSkill: opts.weaponSkill,
    spellSchool: opts.spellSchool,
    songSchool: opts.songSchool,
  };

  let defenderStatus: any = undefined;
  try {
    defenderStatus = computeEntityCombatStatusSnapshot(npc as any);
  } catch {
    // Defender snapshot must never crash NPC combat; ignore on error.
  }

  const target: CombatTarget = {
    entity: npc,
    armor: (npc as any).armor ?? 0,
    resist: (npc as any).resist ?? {},
    defenderStatus,
  };


  // --- Physical hit resolution (miss/dodge/parry/block + crit/multi/riposte hooks) ---
  const channel = opts.channel ?? "weapon";
  const isPhysical = channel === "weapon" || channel === "ability";
  const defenderLevel = getDefenderLevel(ctx, npc);

  if (isPhysical) {
    const weaponSkillId: WeaponSkillId = (opts.weaponSkill ?? "one_handed") as WeaponSkillId;

    let weaponSkillPoints = 0;
    try {
      weaponSkillPoints = getWeaponSkill(char, weaponSkillId);
    } catch {
      weaponSkillPoints = 0;
    }

    const capPoints = getWeaponSkillCapPoints(char);

    const phys = resolvePhysicalHit({
      attackerLevel: char.level ?? 1,
      defenderLevel,
      weaponSkillPoints,
      defenderDefenseSkillPoints: defenderLevel * 5,
      // Later: wire defenderCanBlock/parry based on proto/gear/tags
      defenderCanDodge: true,
      defenderCanParry: true,
      defenderCanBlock: true,
      allowRiposte: true,
      allowCrit: true,
      allowMultiStrike: true,
      rng: opts.rng,
    });

    // --- Weapon-skill progression (attempt-based; non-trivial targets only) ---
    // Train even on misses/avoids so players can climb out of "untrained" hell,
    // but do not allow trivial targets to power-level skills.
    try {
      const gain = computeWeaponSkillGainOnSwingAttempt({
        attackerLevel: char.level ?? 1,
        defenderLevel,
        currentPoints: weaponSkillPoints,
        capPoints,
        didHit: phys.outcome === "hit",
      });
      if (gain > 0) {
        gainWeaponSkill(char, weaponSkillId, gain);
      }
    } catch {
      // Never let progression break combat.
    }

    
let blockMultiplier: number | null = null;
let blockLine: string | null = null;

if (phys.outcome !== "hit") {
  let line = "[combat] ";
  if (phys.outcome === "miss") line += `You miss ${npc.name}.`;
  else if (phys.outcome === "dodge") line += `${npc.name} dodges your attack.`;
  else if (phys.outcome === "parry") line += `${npc.name} parries your attack.`;
  else {
    // Block is a partial mitigation (not a full avoid).
    const mult = typeof (phys as any).blockMultiplier === "number" ? (phys as any).blockMultiplier : 0.7;
    blockMultiplier = mult;
    blockLine = `${npc.name} blocks your attack.`;
  }

  // Parry can immediately riposte (counter-swing). Riposte swings must not chain.
  if (phys.outcome === "parry" && phys.riposte) {
    const rip = await applySimpleNpcCounterAttack(ctx, npc, selfEntity, { isRiposte: true, rng: opts.rng });
    if (rip) line += " (Riposte!) " + rip;
  }

  // Dodge/parry/miss end the attack. Block proceeds with reduced damage.
  if (phys.outcome !== "block") {
    return line;
  }
}

// Feed crit/glancing/multi-strike hints into damage computation below.
(opts as any)._pwCritChance = phys.critChance;
(opts as any)._pwGlancingChance = phys.glancingChance;
(opts as any)._pwStrikes = phys.strikes;
(opts as any)._pwBlockMultiplier = blockMultiplier;
(opts as any)._pwBlockLine = blockLine;
  }
  const result = computeDamage(source, target, {
    damageMultiplier: opts.damageMultiplier,
    flatBonus: opts.flatBonus,
    critChance: typeof (opts as any)._pwCritChance === "number" ? (opts as any)._pwCritChance : undefined,
    glancingChance: typeof (opts as any)._pwGlancingChance === "number" ? (opts as any)._pwGlancingChance : undefined,
    // Enable defender taken modifiers when we have a snapshot (NPC debuffs).
    applyDefenderDamageTakenMods: true,
  });

  // rawDamage = what CombatEngine rolled
  let baseRawDamage = result.damage;

  // v1.4: If the attacker is a pet entity, apply role/species + gear damage multipliers.
  // Note: CombatEngine currently scales from the *owner character*; this multiplier
  // makes the pet distinct without changing the entire damage pipeline.
  if ((selfEntity as any)?.type === "pet") {
    try {
      const petMult = Math.max(0.1, getProfileDamageMult(selfEntity as any) * getPetGearDamageMult(selfEntity as any));
      baseRawDamage = Math.max(0, Math.floor(baseRawDamage * petMult));
    } catch {
      // best-effort
    }
  }
  const strikes = typeof (opts as any)._pwStrikes === "number" ? (opts as any)._pwStrikes : 1;
  const rawDamage = Math.max(0, Math.floor(baseRawDamage * Math.max(1, strikes)));
  let dmg = rawDamage;

  // Apply block mitigation (if defender blocked this swing).
  const blockMult = typeof (opts as any)._pwBlockMultiplier === "number" ? (opts as any)._pwBlockMultiplier : null;
  if (blockMult != null) {
    dmg = Math.max(1, Math.floor(dmg * blockMult));
  }

  // Snapshot HP before damage for messaging
  const prevHp = (npc as any).hp ?? (npc as any).maxHp ?? 1;
  const maxHp = (npc as any).maxHp ?? prevHp;

  // Let NpcManager own HP + crime + pack calls when available
  let newHp = Math.max(0, prevHp - dmg);

  if (ctx.npcs) {
    const appliedHp = ctx.npcs.applyDamage(npc.id, dmg, {
      character: char,
      entityId: selfEntity.id,
    });

    // If manager returns an authoritative HP value, correct dmg to actual delta.
    if (typeof appliedHp === "number") {
      const effectiveDamage = Math.max(0, prevHp - appliedHp);
      dmg = effectiveDamage;
      newHp = appliedHp;
    } else {
      // Fallback if manager couldn't find the NPC or returned null/undefined
      (npc as any).hp = newHp;
    }

    // Update threat so brains see the attacker (use actual damage when available)
    ctx.npcs.recordDamage(npc.id, selfEntity.id, dmg);
    // Option A: same-room assist (conservative opt-in via proto tags)
    try {
      tryAssistNearbyNpcs(ctx, npc.id, selfEntity.id, Date.now(), Math.floor(Math.max(1, dmg) * 0.25), dmg);
    } catch {
      // Assist is best-effort; combat should never fail because help logic failed.
    }
  } else {
    // Legacy / test fallback with no NpcManager
    (npc as any).hp = newHp;
  }

  // --- Skill progression for the attacker ---
  try {
    const channel = opts.channel ?? "weapon";
    if (channel === "spell") {
      if (opts.songSchool) {
        // Songs train their instrument/vocal school only
        gainSongSchoolSkill(char, opts.songSchool, 1);
      } else if (opts.spellSchool && opts.spellSchool !== "song") {
        // Normal spells train their magic school
        gainSpellSchoolSkill(char, opts.spellSchool, 1);
      }
    }
  } catch {
    // Never let progression break combat
  }

  // --- Resource generation for the attacker (fury/runic power v1) ---
try {
  const primaryRes = getPrimaryPowerResourceForClass(char.classId);
  if (dmg > 0) {
    if (primaryRes === "fury") {
      const gain = 5 + Math.floor(dmg / 5); // 6–15ish at low levels
      gainPowerResource(char, "fury", gain);
    } else if (primaryRes === "runic_power") {
      // Runic Power builds a little faster than Fury to support spender gameplay.
      const gain = 6 + Math.floor(dmg / 6); // 6–18ish at low levels
      gainPowerResource(char, "runic_power", gain);
    }
  }
} catch {
  // Never let progression break combat
}

// --- Build combat line ---

  // Keep spell/song direct damage lines consistent with DOT/HOT tick formatting.
  const prefix = opts.tagPrefix ?? "ability";
  const isWorldSpellLine =
    !!opts.abilityName && (prefix === "spell" || prefix === "song");

  let tag = "[combat]";
  if (opts.abilityName) {
    if (prefix === "spell" || prefix === "song") {
      tag = `[world] [${prefix}:${opts.abilityName}]`;
    } else {
      tag = `[${prefix}:${opts.abilityName}]`;
    }
  }

  const overkill = rawDamage > dmg ? rawDamage - dmg : 0;

  const targetMaxHp = typeof (npc as any).maxHp === "number" ? (npc as any).maxHp : undefined;

  let line: string;
  if (isWorldSpellLine) {
    line = formatWorldSpellDirectDamageLine({
      abilityKind: prefix as "spell" | "song",
      spellName: opts.abilityName as string,
      targetName: npc.name,
      damage: rawDamage,
      overkill,
      hpAfter: newHp,
      maxHp,
    });

} else {
  const blk = (opts as any)._pwBlockLine as string | null;
  line = `${tag} ${blk ? blk + " " : ""}You hit ${npc.name} for ${rawDamage} damage`;
  if (overkill > 0) {
    line += ` (${overkill} overkill)`;
  }
  line += `. (${newHp}/${targetMaxHp ?? "?"} HP)`;
}

  if (result.wasCrit) {
    line += " (Critical hit!)";
  } else if (result.wasGlancing) {
    line += " (Glancing blow.)";
  }

  if (strikes === 2) {
    line += " (Double Attack!)";
  } else if (strikes === 3) {
    line += " (Triple Attack!)";
  }

  // If the NPC survives, simple counterattack and we’re done.
  if (newHp > 0) {
    // v1.4: Pet gear procs (on hit). These are *extra* effects after the main hit.
    // We keep the output additive and do not reformat the primary hit line.
    try {
      if ((selfEntity as any)?.type === "pet") {
        const proc = await tryTriggerPetOnHitProcs(ctx, char, selfEntity as any, npc as any, opts);
        if (proc && proc.snippets.length) {
          line += " " + proc.snippets.join("; ") + ".";
          // If a proc killed the NPC, skip counterattack and route through reward pipeline.
          const hpNow = (npc as any).hp ?? newHp;
          if (hpNow <= 0) {
            return await finalizeNpcKillAndRewards(ctx, char, selfEntity, npc, line);
          }
        }
      }
    } catch {
      // ignore
    }

    const counter = await applySimpleNpcCounterAttack(ctx, npc, selfEntity);
    if (counter) line += " " + counter;
    return line;
  }

    return await finalizeNpcKillAndRewards(ctx, char, selfEntity, npc, line);
}

export interface NpcCounterAttackOptions {
  /**
   * When true, this swing is a riposte counter-swing.
   * Riposte swings must never themselves trigger additional ripostes (no infinite ping-pong).
   */
  isRiposte?: boolean;

  /**
   * Deterministic RNG hook for tests.
   * If omitted, PhysicalHitResolver will use its own deterministic default in test env.
   */
  rng?: () => number;
}


/**
 * Very simple NPC → player counter-attack used by all v1 brains.
 *
 * Cowards are special-cased: they never get this free swing.
 * Their only reaction should be “run away” on the next brain tick.
 */

export interface PlayerRiposteOptions {
  rng?: () => number;
}

async function applySimplePlayerRiposteAgainstNpc(
  ctx: SimpleCombatContext,
  player: Entity,
  npc: Entity,
  opts: PlayerRiposteOptions = {},
): Promise<string | null> {
  const p: any = player;
  const n: any = npc;

  const char = (ctx.session?.character ?? null) as CharacterState | null;
  if (!char) return null;
  if (isDeadEntity(p) || isDeadEntity(n)) return null;

  const defenderLevel = getDefenderLevel(ctx, npc);
  const attackerLevel = (char.level ?? 1) as number;

  // v1.1.1: riposte is a real counter-swing, but we keep it non-lethal until
  // kill/reward pipelines are unified for reactive hits.
  const weaponSkillId: WeaponSkillId = "one_handed";
  let weaponSkillPoints = 0;
  try {
    weaponSkillPoints = getWeaponSkill(char, weaponSkillId);
  } catch {
    weaponSkillPoints = 0;
  }

  const phys = resolvePhysicalHit({
    attackerLevel,
    defenderLevel,
    weaponSkillPoints,
    defenderDefenseSkillPoints: defenderLevel * 5,
    defenderCanDodge: true,
    defenderCanParry: true,
    defenderCanBlock: true,
    allowCrit: false,
    allowMultiStrike: false,
    // Riposte swings must never chain.
    allowRiposte: false,
    rng: opts.rng,
  });

  if (phys.outcome !== "hit" && phys.outcome !== "block") {
    if (phys.outcome === "miss") return `You miss ${npc.name} with your riposte.`;
    if (phys.outcome === "dodge") return `${npc.name} dodges your riposte.`;
    if (phys.outcome === "parry") return `${npc.name} parries your riposte.`;
    return null;
  }

  // v1.1.4: riposte uses the real weapon damage model (but stays deterministic).
// We intentionally avoid computeEffectiveAttributes() here because contract tests
// often provide minimal character objects; CombatEngine.computeDamage() already
// falls back to safe defaults when attributes are missing.
const source: CombatSource = {
  char,
  effective: {},
  channel: "weapon",
  weaponSkill: weaponSkillId,
  tags: ["riposte"],
};
const target: CombatTarget = { entity: npc };

// Disable crit/glancing for ripostes (for now) to keep RNG consumption minimal
// and results stable in contract tests.
let dmg = computeDamage(source, target, {
  rng: opts.rng,
  disableCrit: true,
  disableGlancing: true,
}).damage;

// Block mitigates riposte damage too (this multiplier comes from the hit resolver).
if (phys.outcome === "block") {
  const mult =
    typeof (phys as any).blockMultiplier === "number"
      ? (phys as any).blockMultiplier
      : 0.7;
  dmg = Math.max(1, Math.floor(dmg * mult));
}

  const prevHp = typeof n.hp === "number" ? n.hp : (typeof n.maxHp === "number" ? n.maxHp : 1);
  const maxHp = typeof n.maxHp === "number" ? n.maxHp : prevHp;

  // v1.1.3: riposte can be lethal; kill/rewards are unified via finalizeNpcKillAndRewards.

  let newHp = prevHp;
  if (dmg > 0) {
    if (ctx.npcs) {
      const appliedHp = ctx.npcs.applyDamage(npc.id, dmg, {
        character: char,
        entityId: player.id,
      });

      if (typeof appliedHp === "number") {
        newHp = appliedHp;
      } else {
        newHp = Math.max(0, prevHp - dmg);
        n.hp = newHp;
      }

      try {
        ctx.npcs.recordDamage(npc.id, player.id, dmg);
      } catch {
        // ignore
      }
    } else {
      newHp = Math.max(0, prevHp - dmg);
      n.hp = newHp;
    }
  }

  markInCombat(p);
  markInCombat(n);

  if (newHp <= 0) {
    const baseLine = `You riposte ${npc.name} for ${dmg} damage.`;
    try {
      return await finalizeNpcKillAndRewards(ctx, char, player, npc, baseLine);
    } catch {
      return baseLine;
    }
  }

  const maybeBlock = phys.outcome === "block" ? `${npc.name} blocks your riposte. ` : "";
  return `${maybeBlock}You riposte ${npc.name} for ${dmg} damage. (${newHp}/${maxHp} HP)`;
}

export async function applySimpleNpcCounterAttack(
  ctx: SimpleCombatContext,
  npc: Entity,
  player: Entity,
  opts: NpcCounterAttackOptions = {},
): Promise<string | null> {
  const p: any = player;
  const n: any = npc;

  // Protected/invulnerable targets should not take counter-attack damage.
  // (Prevents “hit for X” messages when the target is immune.)
  const svc = serviceProtectionGate(player);
  if (svc && !svc.allowed) {
    return null;
  }

  if (isDeadEntity(p)) {
    return null;
  }


  // --- Special-case: training dummies never counter-attack ---
  // They exist for DPS testing, not murder.
  try {
    if (ctx.npcs) {
      const st = ctx.npcs.getNpcStateByEntityId(npc.id);
      if (st) {
        const proto = getNpcPrototype(st.templateId) ?? getNpcPrototype(st.protoId);
        const tags = proto?.tags ?? [];
        if (
          tags.includes("training") ||
          tags.includes("law_exempt") ||
          st.protoId === "training_dummy" ||
          st.protoId === "training_dummy_big" ||
          st.templateId === "training_dummy" ||
          st.templateId === "training_dummy_big"
        ) {
          return null;
        }
      }
    }
  } catch {
    // ignore
  }


  // --- Coward special-case: no reactive counter-attacks ---
  try {
    if (ctx.npcs) {
      const st = ctx.npcs.getNpcStateByEntityId(npc.id);
      if (st) {
        const proto = getNpcPrototype(st.templateId) ?? getNpcPrototype(st.protoId);
        const behavior = proto?.behavior ?? "aggressive";
        const tags = proto?.tags ?? [];
        const isCowardProto =
          behavior === "coward" ||
          st.protoId === "coward_rat" ||
          st.templateId === "coward_rat" ||
          tags.includes("coward_test");
        if (isCowardProto) {
          // Cowards will flee on their AI tick instead of swinging back.
          return null;
        }
      }
    }
  } catch {
    // Best-effort; fall through to normal behavior on failure.
  }

  // --- Physical outcome resolution (NPC -> Player) ---
  const npcLevel = getDefenderLevel(ctx, npc);
  const defenderLevel = (ctx.session?.character?.level ?? 1) as number;

  const defenderChar = (ctx.session?.character ?? null) as CharacterState | null;
  const defenseSkillPoints = defenderChar ? getDefenseSkill(defenderChar) : 0;

  const phys = resolvePhysicalHit({
    attackerLevel: npcLevel,
    defenderLevel,
    weaponSkillPoints: npcLevel * 5,
    defenderDefenseSkillPoints: defenseSkillPoints,
    defenderCanDodge: true,
    defenderCanParry: true,
    defenderCanBlock: true,
    allowCrit: false,
    allowMultiStrike: false,
    // Player parries may riposte unless this NPC swing is itself a riposte.
    allowRiposte: opts.isRiposte ? false : true,
    rng: opts.rng,
  });

  // Progress defense skill whenever you're attacked (v1: simple +1 tick).
  if (defenderChar) {
    gainDefenseSkill(defenderChar, 1);
  }

  
if (phys.outcome !== "hit") {
  // Tag NPC as in combat even on avoided swings.
  markInCombat(n);

  let line = "[combat] ";

  if (phys.outcome === "miss") {
    line += `${npc.name} misses you.`;
    return line;
  }

  if (phys.outcome === "dodge") {
    line += `You dodge ${npc.name}'s attack.`;
    return line;
  }

  if (phys.outcome === "parry") {
    line += `You parry ${npc.name}'s attack.`;

    // A successful parry can trigger an immediate player riposte counter-swing.
    // Riposte swings must never chain into further ripostes.
    if (phys.riposte && !opts.isRiposte) {
      const rip = await applySimplePlayerRiposteAgainstNpc(ctx, player, npc, { rng: opts.rng });
      if (rip) line += ` (Riposte!) ${rip}`;
    }

    return line;
  }

  // Block is partial mitigation (not a full avoid): apply reduced damage.
  const base = computeNpcMeleeDamage(npc);
  const mult = typeof (phys as any).blockMultiplier === "number" ? (phys as any).blockMultiplier : 0.7;
  const dmgBlocked = Math.max(1, Math.floor(base * mult));

  // IMPORTANT: pass the CharacterState so damageTakenPct (cowardice, curses, etc.)
  // can actually modify incoming damage.
  const char = defenderChar;

  const { newHp, maxHp, killed } = applySimpleDamageToPlayer(
    player,
    dmgBlocked,
    char ?? undefined,
    "physical",
  );

  // Tag NPC as "in combat" too (player is tagged inside applySimpleDamageToPlayer).
  markInCombat(n);

  if (killed) {
    const deadChar = ctx.session.character as any;
    if (deadChar?.melody) {
      deadChar.melody.active = false;
    }
    return (
      `[combat] You block ${npc.name}'s attack but still take ${dmgBlocked} damage. ` +
      `You die. (0/${maxHp} HP) ` +
      "Use 'respawn' to return to safety or wait for someone to resurrect you."
    );
  }

  return `[combat] You block ${npc.name}'s attack and take ${dmgBlocked} damage. (${newHp}/${maxHp} HP)`;
}

const dmg = computeNpcMeleeDamage(npc);

  // IMPORTANT: pass the CharacterState so damageTakenPct (cowardice, curses, etc.)
  // can actually modify incoming damage.
  const char = defenderChar;

  const { newHp, maxHp, killed } = applySimpleDamageToPlayer(
    player,
    dmg,
    char ?? undefined,
    "physical",
  );

  // Tag NPC as "in combat" too (player is tagged inside applySimpleDamageToPlayer).
  markInCombat(n);

  if (killed) {
    const deadChar = ctx.session.character as any;
    if (deadChar?.melody) {
      deadChar.melody.active = false;
    }
    return (
      `[combat] ${npc.name} hits you for ${dmg} damage. ` +
      `You die. (0/${maxHp} HP) ` +
      "Use 'respawn' to return to safety or wait for someone to resurrect you."
    );
  }

  return `[combat] ${npc.name} hits you for ${dmg} damage. (${newHp}/${maxHp} HP)`;
}

/**
 * Small helper for sending “X returns.” style flavor to a room.
 */

/**
 * Best-effort: extract entity ids from a Room-ish object without depending on a concrete Room implementation.
 * This keeps assist wiring robust across server/client test contexts.
 */
function getRoomEntityIds(room: any): string[] {
  if (!room) return [];
  if (Array.isArray(room.entityIds))
    return room.entityIds.filter((x: any) => typeof x === "string");
  const st = room.state ?? room._state;
  if (st && Array.isArray(st.entityIds))
    return st.entityIds.filter((x: any) => typeof x === "string");

  const ents = room.entities ?? room._entities;
  if (ents instanceof Map)
    return Array.from(ents.keys()).filter((x) => typeof x === "string");
  if (ents && typeof ents === "object") return Object.keys(ents);

  return [];
}

type GridRoomCoord = { shard: string; gx: number; gy: number };

function parseGridRoomId(roomId: string): GridRoomCoord | null {
  // Expected formats:
  // - "prime_shard:0,-1"
  // - "prime:12,34"
  const idx = roomId.indexOf(":");
  if (idx <= 0) return null;
  const shard = roomId.slice(0, idx);
  const rest = roomId.slice(idx + 1);
  const parts = rest.split(",");
  if (parts.length !== 2) return null;
  const gx = Number.parseInt(parts[0], 10);
  const gy = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return null;
  return { shard, gx, gy };
}

function formatGridRoomId(c: GridRoomCoord): string {
  return `${c.shard}:${c.gx},${c.gy}`;
}

function getNearbyRoomIds(roomId: string, radiusTiles: number): string[] {
  if (radiusTiles <= 0) return [roomId];
  const parsed = parseGridRoomId(roomId);
  if (!parsed) return [roomId];

  const r = Math.max(0, Math.floor(radiusTiles));
  const out: string[] = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      // Diamond (Manhattan) neighborhood keeps it tighter than a square.
      if (Math.abs(dx) + Math.abs(dy) > r) continue;
      out.push(formatGridRoomId({ shard: parsed.shard, gx: parsed.gx + dx, gy: parsed.gy + dy }));
    }
  }
  return out;
}

function computeAssistSeedThreat(baseSeedThreat: number, proto: any, ent: any): number {
  const tags = (proto?.tags ?? ent?.tags ?? []) as any[];
  const name = (typeof ent?.name === "string" ? ent.name : "") as string;

  let mult = 1;

  const hasTag = (t: string) => Array.isArray(tags) && tags.includes(t);
  const nameHas = (sub: string) => name.toLowerCase().includes(sub);

  // Flavor-based heuristics (deterministic):
  // - rats/vermin help a little
  // - guards/soldiers help a lot
  if (hasTag("rat") || hasTag("vermin") || nameHas("rat")) mult *= 0.5;
  if (hasTag("guard") || hasTag("soldier") || hasTag("elite") || nameHas("guard")) mult *= 2;

  // Explicit tuning tags override heuristics if present.
  if (hasTag("assist_weak")) mult = 0.5;
  if (hasTag("assist_strong")) mult = 2;

  const scaled = Math.round(baseSeedThreat * mult);
  return Math.max(1, Number.isFinite(scaled) ? scaled : Math.max(1, Math.round(baseSeedThreat)));
}

// Assist gating knobs (wired to env; defaults match NpcThreat.getAssistTargetForAlly defaults)
const PW_ASSIST_AGGRO_WINDOW_MS = Math.max(0, envInt("PW_ASSIST_AGGRO_WINDOW_MS", 5000));
const PW_ASSIST_MIN_TOP_THREAT = Math.max(0, envInt("PW_ASSIST_MIN_TOP_THREAT", 1));

/**
 * Assist wiring (Option B default): radius-based assist with per-assister throttle.
 *
 * - Same-room assist still works even if room ids aren't grid-formatted.
 * - If room ids are grid-formatted ("shard:x,y"), allies within a small tile radius can assist,
 *   enabling "train" behavior when players ignore gating/escape mobs.
 *
 * Env knobs:
 * - PW_ASSIST_RADIUS_TILES (default 2) : Manhattan radius in tile rooms.
 * - PW_ASSIST_CALLS_LINE (default true): emit a "calls for help!" chat line when assist triggers.
 */
export function tryAssistNearbyNpcs(
  ctx: SimpleCombatContext,
  allyNpcEntityId: string,
  attackerEntityId: string,
  now: number,
  seedThreat: number,
  damageDealt?: number,
): number {
  if (!ctx?.npcs || !ctx?.entities || !ctx?.rooms) return 0;

  const allySt = ctx.npcs.getNpcStateByEntityId(allyNpcEntityId);
  if (!allySt) return 0;

  const roomId = allySt.roomId;
  if (!roomId) return 0;

  const allyEnt: any = ctx.entities.get(allyNpcEntityId);
  if ((allyEnt as any)?.type === "node") return 0;

  // --- Gate-for-help ("trains") ---
  // Some NPCs can "gate" to call allies from a much larger radius.
  // This is *event-driven* (piggybacks on tryAssist calls) to keep it simple.
  const gateEnabled = envBool("PW_GATE_FOR_HELP_ENABLED", true);
  const gateTag = String(process.env.PW_GATE_FOR_HELP_TAG ?? "gater");
  const gateCastMs = envInt("PW_GATE_FOR_HELP_CAST_MS", 9000);
  const gateCooldownMs = envInt("PW_GATE_FOR_HELP_COOLDOWN_MS", 20000);
  const gateHpPct = envFloat("PW_GATE_FOR_HELP_HP_PCT", 0.5);
  const gateRadiusTiles = envInt("PW_GATE_FOR_HELP_RADIUS_TILES", 6);
  const gateSeedThreatMult = envFloat("PW_GATE_FOR_HELP_SEED_MULT", 2);
  const gateInterruptHpPct = envFloat("PW_GATE_FOR_HELP_INTERRUPT_HP_PCT", 0.12);
  const gateInterruptFlat = envInt("PW_GATE_FOR_HELP_INTERRUPT_FLAT", 0);

  const allyThreat: any = (allySt as any).threat;
  const assistTarget = getAssistTargetForAlly(allyThreat, now, { windowMs: PW_ASSIST_AGGRO_WINDOW_MS, minTopThreat: PW_ASSIST_MIN_TOP_THREAT });

  const ASSIST_COOLDOWN_MS = envInt("PW_ASSIST_COOLDOWN_MS", 4000);
  let radiusTiles = envInt("PW_ASSIST_RADIUS_TILES", 2);
  const enableCallsLine = envBool("PW_ASSIST_CALLS_LINE", true);

  // Resolve ally proto/tags for gate logic.
  const allyProto = getNpcPrototype(allySt.templateId) ?? getNpcPrototype(allySt.protoId);
  const allyTags = (allyProto?.tags ?? (allySt as any).tags ?? (allyEnt as any).tags ?? []) as any[];
  const isTrainingDummy = Array.isArray(allyTags) && (allyTags.includes("training_dummy") || allyTags.includes("dummy"));

  // Gate state is stored on the ally entity to avoid schema churn.
  const lastGateAt: number | undefined = (allyEnt as any)?._pwLastGateForHelpAt;
  let gateEndsAt: number | undefined = (allyEnt as any)?._pwGateForHelpEndsAt;
  const gateDid: boolean | undefined = (allyEnt as any)?._pwGateForHelpDid;

  const hp = typeof (allyEnt as any)?.hp === "number" ? (allyEnt as any).hp : undefined;
  const maxHp = typeof (allyEnt as any)?.maxHp === "number" ? (allyEnt as any).maxHp : undefined;
  const hpPctNow = hp != null && maxHp != null && maxHp > 0 ? hp / maxHp : 1;

  const hasGateTag =
    gateEnabled &&
    Array.isArray(allyTags) &&
    (allyTags.includes(gateTag) || allyTags.includes("gater") || allyTags.includes("gate_for_help") || allyTags.includes("calls_for_help_gate"));
  const canStartGate =
    gateEnabled &&
    hasGateTag &&
    !!assistTarget &&
    assistTarget === attackerEntityId &&
    !isTrainingDummy &&
    hpPctNow <= gateHpPct &&
    (!lastGateAt || now - lastGateAt >= gateCooldownMs) &&
    (!gateEndsAt || (gateDid && now - (lastGateAt ?? 0) >= gateCooldownMs));

  // If a gate is in progress, we don't do normal small-radius assist.
  // Instead we wait for the cast to complete then do a big-radius assist burst.
  if (gateEnabled && hasGateTag && gateEndsAt && !gateDid) {

// Hard CC interrupt: if the gater is stunned/rooted/etc during the cast, cancel immediately.
try {
  const ccTagsRaw = String(process.env.PW_GATE_FOR_HELP_CC_TAGS ?? "stun,root,mez,incapacitate,fear,sleep,knockdown");
  const ccTags = ccTagsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ccTags.length > 0) {
    const active = getActiveStatusEffectsForEntity(allyEnt as any, now);
    const hasCc = active.some((e) => Array.isArray(e.tags) && e.tags.some((t) => ccTags.includes(String(t))));
    if (hasCc) {
      (allyEnt as any)._pwGateForHelpEndsAt = undefined;
      (allyEnt as any)._pwGateForHelpDid = true;
      (allyEnt as any)._pwLastGateForHelpAt = now;
      (allyEnt as any)._pwGateForHelpWavesRemaining = 0;
      (allyEnt as any)._pwGateForHelpNextWaveAt = 0;
      try {
        const room: any = ctx.rooms.get(roomId);
        room?.broadcast?.("chat", {
          from: "[combat]",
          sessionId: "system",
          text: `${allyEnt?.name ?? "Someone"}'s gate is interrupted!`,
          t: now,
        });
      } catch {
        // ignore
      }
      return 0;
    }
  }
} catch {
  // ignore
}

// Pushback: taking damage during the cast delays completion (up to caps).
const gatePushbackPerDmgMs = envInt("PW_GATE_FOR_HELP_PUSHBACK_PER_DMG_MS", 50);
const gatePushbackMaxMs = envInt("PW_GATE_FOR_HELP_PUSHBACK_MAX_MS", 2000);
const gatePushbackTotalMaxMs = envInt("PW_GATE_FOR_HELP_PUSHBACK_TOTAL_MAX_MS", 6000);
    // Interrupt window: taking enough damage while gating cancels the gate.
    const dmgIn = Math.max(0, Number(damageDealt ?? 0));
    if (dmgIn > 0) {
      const prevDmg = Number((allyEnt as any)._pwGateForHelpDamageTaken ?? 0);
      const nextDmg = prevDmg + dmgIn;
      (allyEnt as any)._pwGateForHelpDamageTaken = nextDmg;

// Apply pushback based on incoming damage.
if (gatePushbackPerDmgMs > 0 && gateEndsAt) {
  const rawPush = Math.floor(dmgIn * gatePushbackPerDmgMs);
  const push = Math.max(0, Math.min(gatePushbackMaxMs, rawPush));
  const prevTotal = Number((allyEnt as any)._pwGateForHelpPushbackTotalMs ?? 0);
  const total = Math.min(gatePushbackTotalMaxMs, prevTotal + push);
  const applied = Math.max(0, total - prevTotal);
  if (applied > 0) {
    gateEndsAt = gateEndsAt + applied;
    (allyEnt as any)._pwGateForHelpEndsAt = gateEndsAt;
    (allyEnt as any)._pwGateForHelpPushbackTotalMs = total;
  }
}


      const hpBase = typeof maxHp === "number" ? maxHp : 0;
      const pctThreshold = Math.floor(Math.max(0, hpBase) * Math.max(0, gateInterruptHpPct));
      const threshold = Math.max(gateInterruptFlat, pctThreshold);

      if (threshold > 0 && nextDmg >= threshold) {
        (allyEnt as any)._pwGateForHelpEndsAt = undefined;
        (allyEnt as any)._pwGateForHelpDid = true;
        (allyEnt as any)._pwLastGateForHelpAt = now;
        try {
          const room: any = ctx.rooms.get(roomId);
          room?.broadcast?.("chat", {
            from: "[combat]",
            sessionId: "system",
            text: `${allyEnt?.name ?? "Someone"}'s gate fizzles!`,
            t: now,
          });
        } catch {
          // ignore
        }
        return 0;
      }
    }
    const gateEndsAtNow = Number((allyEnt as any)?._pwGateForHelpEndsAt ?? gateEndsAt ?? 0);
    if (gateEndsAtNow > 0 && now >= gateEndsAtNow) {
      // Cast complete: start or continue multi-wave assist pulses.
      const waveIntervalMs = envInt("PW_GATE_FOR_HELP_WAVE_INTERVAL_MS", 3000);
      const maxWaves = envInt("PW_GATE_FOR_HELP_WAVES", 3);
      const maxEsc = envInt("PW_GATE_FOR_HELP_ESCALATION_MAX", 3);
      const escRadiusStep = envInt("PW_GATE_FOR_HELP_ESCALATION_RADIUS_STEP", 1);
      const escSeedMultStep = envFloat("PW_GATE_FOR_HELP_ESCALATION_SEED_MULT_STEP", 0.5);

      // Escalation increases after each successful gate completion.
      const prevEsc = Number((allyEnt as any)._pwGateForHelpEscalation ?? 0);
      const escNow = Math.min(maxEsc, Math.max(0, prevEsc) + 1);
      (allyEnt as any)._pwGateForHelpEscalation = escNow;

      // Initialize waves if this is the first completion tick.
      const existingWaves = Number((allyEnt as any)._pwGateForHelpWavesRemaining ?? 0);
      if (!Number.isFinite(existingWaves) || existingWaves <= 0) {
        const wavesTotal = Math.max(1, Math.floor(maxWaves));
        (allyEnt as any)._pwGateForHelpWavesRemaining = wavesTotal;
        (allyEnt as any)._pwGateForHelpNextWaveAt = now; // wave 1 fires immediately
      }

      // Gate is considered "did" once the first completion tick happens.
      (allyEnt as any)._pwGateForHelpDid = true;
      (allyEnt as any)._pwLastGateForHelpAt = now;

      const nextWaveAt = Number((allyEnt as any)._pwGateForHelpNextWaveAt ?? now);
      let wavesRemaining = Number((allyEnt as any)._pwGateForHelpWavesRemaining ?? 0);

      if (wavesRemaining > 0 && now >= nextWaveAt) {
        const waveIndex = Math.max(0, (Math.max(1, Math.floor(maxWaves)) - wavesRemaining));
        const isFirstWave = waveIndex === 0;

        try {
          const room: any = ctx.rooms.get(roomId);
          room?.broadcast?.("chat", {
            from: "[combat]",
            sessionId: "system",
            text: isFirstWave
              ? `${allyEnt?.name ?? "Someone"} gates for help!`
              : `${allyEnt?.name ?? "Someone"} tears the rift wider!`,
            t: now,
          });
        } catch {
          // ignore
        }

        // Compute this wave's radius + seed with escalation.
        const effectiveRadius = Math.max(0, Math.floor(gateRadiusTiles + escNow * escRadiusStep));
        const effectiveSeedMult = Math.max(1, gateSeedThreatMult + escNow * escSeedMultStep);
        const boostedSeed = Math.max(1, Math.round(seedThreat * effectiveSeedMult));

        const gateTarget = ((allyEnt as any)._pwGateForHelpTargetId ?? attackerEntityId) as string;

        // Consume a wave and schedule the next one.
        wavesRemaining = Math.max(0, wavesRemaining - 1);
        (allyEnt as any)._pwGateForHelpWavesRemaining = wavesRemaining;
        (allyEnt as any)._pwGateForHelpNextWaveAt = now + waveIntervalMs;

        const maxAssists = envInt("PW_GATE_FOR_HELP_MAX_ASSISTS_PER_WAVE", 3);
        const pulledArr = ((allyEnt as any)._pwGateForHelpPulledIds ?? []) as string[];
        const exclude = new Set<string>(pulledArr);
        return doAssistScan(
          ctx,
          roomId,
          allyNpcEntityId,
          gateTarget,
          now,
          boostedSeed,
          effectiveRadius,
          ASSIST_COOLDOWN_MS,
          enableCallsLine,
          allyEnt,
          maxAssists,
          exclude,
          (id) => {
            if (!exclude.has(id)) { exclude.add(id); pulledArr.push(id); }
            (allyEnt as any)._pwGateForHelpPulledIds = pulledArr;
          },
        );
      }

      return 0;
    }
    return 0;
  }  // If a completed gate has remaining waves scheduled, process them here (event-driven).
  const wavesRemainingPost = Number((allyEnt as any)._pwGateForHelpWavesRemaining ?? 0);
  const nextWaveAtPost = Number((allyEnt as any)._pwGateForHelpNextWaveAt ?? 0);
  if (gateEnabled && hasGateTag && gateDid && wavesRemainingPost > 0 && now >= nextWaveAtPost) {
    const waveIntervalMs = envInt("PW_GATE_FOR_HELP_WAVE_INTERVAL_MS", 3000);
    const maxWaves = envInt("PW_GATE_FOR_HELP_WAVES", 3);
    const maxEsc = envInt("PW_GATE_FOR_HELP_ESCALATION_MAX", 3);
    const escRadiusStep = envInt("PW_GATE_FOR_HELP_ESCALATION_RADIUS_STEP", 1);
    const escSeedMultStep = envFloat("PW_GATE_FOR_HELP_ESCALATION_SEED_MULT_STEP", 0.5);

    // Optional post-cast disruption: taking enough damage collapses the rift and stops future waves.
    const dmgInPost = Math.max(0, Number(damageDealt ?? 0));
    if (dmgInPost > 0) {
      const prevPost = Number((allyEnt as any)._pwGateForHelpPostDamageTaken ?? 0);
      const nextPost = prevPost + dmgInPost;
      (allyEnt as any)._pwGateForHelpPostDamageTaken = nextPost;

      const hpBase = typeof maxHp === "number" ? maxHp : 0;
      const pctThreshold = Math.floor(Math.max(0, hpBase) * Math.max(0, gateInterruptHpPct));
      const threshold = Math.max(gateInterruptFlat, pctThreshold);

      if (threshold > 0 && nextPost >= threshold) {
        (allyEnt as any)._pwGateForHelpWavesRemaining = 0;
        (allyEnt as any)._pwGateForHelpNextWaveAt = 0;
        try {
          const room: any = ctx.rooms.get(roomId);
          room?.broadcast?.("chat", {
            from: "[combat]",
            sessionId: "system",
            text: `${allyEnt?.name ?? "Someone"}'s rift collapses!`,
            t: now,
          });
        } catch {
          // ignore
        }
        return 0;
      }
    }

    const escNow = Math.min(maxEsc, Math.max(0, Number((allyEnt as any)._pwGateForHelpEscalation ?? 0)));
    const wavesTotal = Math.max(1, Math.floor(maxWaves));
    const waveIndex = Math.max(0, wavesTotal - wavesRemainingPost);
    const isFirstWave = waveIndex === 0;

    try {
      const room: any = ctx.rooms.get(roomId);
      room?.broadcast?.("chat", {
        from: "[combat]",
        sessionId: "system",
        text: isFirstWave
          ? `${allyEnt?.name ?? "Someone"} gates for help!`
          : `${allyEnt?.name ?? "Someone"} tears the rift wider!`,
        t: now,
      });
    } catch {
      // ignore
    }

    const effectiveRadius = Math.max(0, Math.floor(gateRadiusTiles + escNow * escRadiusStep));
    const effectiveSeedMult = Math.max(1, gateSeedThreatMult + escNow * escSeedMultStep);
    const boostedSeed = Math.max(1, Math.round(seedThreat * effectiveSeedMult));
    const gateTarget = ((allyEnt as any)._pwGateForHelpTargetId ?? attackerEntityId) as string;

    (allyEnt as any)._pwGateForHelpWavesRemaining = Math.max(0, wavesRemainingPost - 1);
    (allyEnt as any)._pwGateForHelpNextWaveAt = now + waveIntervalMs;

    const maxAssists = envInt("PW_GATE_FOR_HELP_MAX_ASSISTS_PER_WAVE", 3);
    const pulledArr = ((allyEnt as any)._pwGateForHelpPulledIds ?? []) as string[];
const exclude = new Set<string>(pulledArr);
return doAssistScan(
  ctx,
  roomId,
  allyNpcEntityId,
  gateTarget,
  now,
  boostedSeed,
  effectiveRadius,
  ASSIST_COOLDOWN_MS,
  enableCallsLine,
  allyEnt,
  maxAssists,
  exclude,
  (id) => {
    if (!exclude.has(id)) { exclude.add(id); pulledArr.push(id); }
    (allyEnt as any)._pwGateForHelpPulledIds = pulledArr;
  },
);
  }

  // Start a new gate cast if eligible.
  if (canStartGate) {
    (allyEnt as any)._pwGateForHelpEndsAt = now + gateCastMs;
    (allyEnt as any)._pwGateForHelpDid = false;
    (allyEnt as any)._pwLastGateForHelpAt = now;
    (allyEnt as any)._pwGateForHelpTargetId = attackerEntityId;
    (allyEnt as any)._pwGateForHelpPulledIds = [];
    (allyEnt as any)._pwGateForHelpDamageTaken = 0;
    (allyEnt as any)._pwGateForHelpPushbackTotalMs = 0;
    try {
      const room: any = ctx.rooms.get(roomId);
      room?.broadcast?.("chat", {
        from: "[combat]",
        sessionId: "system",
        text: `${allyEnt?.name ?? "Someone"} begins to gate for help...`,
        t: now,
      });
    } catch {
      // ignore
    }
    return 0;
  }

  // Default assist: small radius.
  if (!assistTarget || assistTarget !== attackerEntityId) return 0;
  return doAssistScan(ctx, roomId, allyNpcEntityId, attackerEntityId, now, seedThreat, radiusTiles, ASSIST_COOLDOWN_MS, enableCallsLine, allyEnt, -1, undefined, undefined);
}


function doAssistScan(
  ctx: SimpleCombatContext,
  roomId: string,
  allyNpcEntityId: string,
  attackerEntityId: string,
  now: number,
  seedThreat: number,
  radiusTiles: number,
  ASSIST_COOLDOWN_MS: number,
  enableCallsLine: boolean,
  allyEnt: any,
  maxAssists: number,
  excludeNpcEntityIds?: Set<string>,
  onAssisted?: (npcEntityId: string) => void,
): number {
  // Gather candidate entity ids across nearby rooms (includes same room).
  const roomIds = getNearbyRoomIds(roomId, radiusTiles);
  const candidateNpcIds: string[] = [];

  for (const rid of roomIds) {
    const room: any = ctx.rooms.get(rid);
    if (!room) continue;
    for (const id of getRoomEntityIds(room)) {
      if (id && typeof id === "string") candidateNpcIds.push(id);
    }
  }

  candidateNpcIds.sort();

  let assisted = 0;

  for (const id of candidateNpcIds) {
    if (!id || id === allyNpcEntityId) continue;
    if (excludeNpcEntityIds && excludeNpcEntityIds.has(id)) continue;

    const ent: any = ctx.entities.get(id);
    if (!ent || ent.type !== "npc") continue;
    if (ent.alive === false) continue;

    const st = ctx.npcs.getNpcStateByEntityId(id);
    if (!st) continue;

    const lastAssistAt = ((ent as any)._pwLastAssistAt ?? (st as any).lastAssistAt) as number | undefined;
    if (lastAssistAt && now - lastAssistAt < ASSIST_COOLDOWN_MS) continue;

    const proto = getNpcPrototype(st.templateId) ?? getNpcPrototype(st.protoId);
    const tags = (proto?.tags ?? (st as any).tags ?? (ent as any).tags ?? []) as any[];
    if (!tags || !Array.isArray(tags)) continue;

    // Never assist with training dummies.
    if (tags.includes("training_dummy") || tags.includes("dummy")) continue;

    // Conservative opt-in assist: only social/assist NPCs.
    const isSocial = tags.includes("social") || tags.includes("assist") || tags.includes("calls_for_help") || tags.includes("calls_for_help_gate");
    if (!isSocial) continue;

    if (maxAssists > 0 && assisted >= maxAssists) break;

    // Don't assist if this NPC is service-protected (prevents tools/admin fixtures from train).
    if (isServiceProtectedNpcProto(proto)) continue;

    // Seed threat on assister so its brain can pick up the attacker.
    (ent as any)._pwLastAssistAt = now;
    (st as any).lastAssistAt = now;

    const scaledSeed = computeAssistSeedThreat(seedThreat, proto, ent);
    ctx.npcs.recordDamage(id, attackerEntityId, scaledSeed);
    assisted++;
    try { onAssisted?.(id); } catch { /* ignore */ }
  }

  // Flavor: announce the call for help once per assist trigger.
  if (assisted > 0 && enableCallsLine) {
    const room: any = ctx.rooms.get(roomId);
    const lastCallAt = (allyEnt as any)?._pwLastCallsForHelpAt as number | undefined;
    if (!lastCallAt || now - lastCallAt >= ASSIST_COOLDOWN_MS) {
      try {
        if (allyEnt) (allyEnt as any)._pwLastCallsForHelpAt = now;
        room?.broadcast?.("chat", {
          from: "[combat]",
          sessionId: "system",
          text: `${(allyEnt?.name ?? "Someone")} calls for help!`,
          t: now,
        });
      } catch {
        // ignore
      }
    }
  }

  return assisted;
}
export function announceSpawnToRoom(
  ctx: SimpleCombatContext,
  roomId: string,
  text: string,
): void {
  if (!ctx.rooms) return;
  const room = ctx.rooms.get(roomId);
  if (!room) return;
  room.broadcast("chat", {
    from: "[world]",
    sessionId: "system",
    text,
    t: Date.now(),
  });
}

/**
 * Shared corpse + respawn behavior for NPCs and resource nodes.
 */
export function scheduleNpcCorpseAndRespawn(
  ctx: SimpleCombatContext,
  npcEntityId: string,
): void {
  if (!ctx.npcs || !ctx.entities) return;

  const st = ctx.npcs.getNpcStateByEntityId(npcEntityId);
  if (!st) return;

  const roomId = st.roomId;
  const templateId = st.templateId;
  const protoId = st.protoId;

  // Resource detection: prefer prototype tags if available.
  const proto = getNpcPrototype(templateId) ?? getNpcPrototype(protoId);
  const isResource =
    proto?.tags?.includes("resource") ||
    proto?.tags?.some((t) => t.startsWith("resource_")) ||
    (ctx.entities.get(npcEntityId) as any)?.type === "node";

  // Capture spawn metadata + baseline "home" coords BEFORE corpse despawn runs.
  const ent0: any = ctx.entities.get(npcEntityId);

  // Idempotency: this function may be invoked more than once for the same death (e.g. extra hits after fatal).
  // Guard against double-despawn/double-respawn which creates duplicate NPCs/corpses.
  if ((st as any)._pwLifecycleScheduled || (ent0 as any)?._pwLifecycleScheduled) return;
  (st as any)._pwLifecycleScheduled = true;
  if (ent0) (ent0 as any)._pwLifecycleScheduled = true;

  const spawnPointId: number | undefined =
    typeof ent0?.spawnPointId === "number"
      ? ent0.spawnPointId
      : typeof (st as any)?.spawnPointId === "number"
        ? (st as any).spawnPointId
        : undefined;

  const spawnId: string | undefined =
    typeof ent0?.spawnId === "string"
      ? ent0.spawnId
      : typeof (st as any)?.spawnId === "string"
        ? (st as any).spawnId
        : undefined;

  const regionId: string | undefined =
    typeof ent0?.regionId === "string"
      ? ent0.regionId
      : typeof (st as any)?.regionId === "string"
        ? (st as any).regionId
        : undefined;

  // Immutable spawn/home coords. Prefer explicit spawnX/Y/Z if present.
  const baseSpawnX =
    typeof ent0?.spawnX === "number"
      ? ent0.spawnX
      : typeof ent0?.x === "number"
        ? ent0.x
        : 0;

  const baseSpawnY =
    typeof ent0?.spawnY === "number"
      ? ent0.spawnY
      : typeof ent0?.y === "number"
        ? ent0.y
        : 0;

  const baseSpawnZ =
    typeof ent0?.spawnZ === "number"
      ? ent0.spawnZ
      : typeof ent0?.z === "number"
        ? ent0.z
        : 0;

  let corpseMs = envInt("PW_CORPSE_RESOURCE_MS", 2500);
  let respawnMs = envInt("PW_RESPAWN_AFTER_CORPSE_MS", 8000);

  // NPC corpses need to stick around long enough for post-kill actions (e.g. skinning).
  // Resources remain fast because they're not skinned and are handled by the personal-node pipeline.
  if (!isResource) {
    corpseMs = envInt("PW_CORPSE_NPC_MS", 15000);

    // Give beasts/critter-style mobs a bit longer since skinning is expected.
    const tags = proto?.tags ?? [];
    if (tags.includes("beast") || tags.includes("critter")) {
      corpseMs = envInt("PW_CORPSE_BEAST_MS", 20000);
    }
  }
// Tests should never wait seconds for lifecycle.
  if (process.env.WORLDCORE_TEST === "1") {
    corpseMs = 5;
    respawnMs = 60;
  }

  // Despawn after corpse delay
  setTimeout(() => {
    const room = ctx.rooms?.get(roomId);
    room?.broadcast("entity_despawn", { id: npcEntityId });
    ctx.npcs?.despawnNpc(npcEntityId);
  }, corpseMs);

  // IMPORTANT: resources are personal/per-owner. Do NOT respawn them as shared entities here.
  if (isResource) {
    return;
  }

  // Normal NPC respawn
  setTimeout(() => {
    // Consult SpawnPointCache *at respawn time* so late updates are honored.
    const cached =
      typeof spawnPointId === "number" ? (getSpawnPoint(spawnPointId) as any) : undefined;

    const spawnX = typeof cached?.x === "number" ? cached.x : baseSpawnX;
    const spawnY = typeof cached?.y === "number" ? cached.y : baseSpawnY;
    const spawnZ = typeof cached?.z === "number" ? cached.z : baseSpawnZ;

    const spawned = ctx.npcs?.spawnNpcById(
      templateId,
      roomId,
      spawnX,
      spawnY,
      spawnZ,
      st.variantId,
    );
    if (!spawned) return;

    const ent = ctx.entities?.get(spawned.entityId) as any;
    const room = ctx.rooms?.get(roomId);

    // Re-attach spawn metadata for contracts + future systems.
    if (ent) {
      if (typeof spawnPointId === "number") ent.spawnPointId = spawnPointId;
      if (typeof spawnId === "string") ent.spawnId = spawnId;
      if (typeof regionId === "string") ent.regionId = regionId;

      ent.spawnX = spawnX;
      ent.spawnY = spawnY;
      ent.spawnZ = spawnZ;
    }

    if (ent && room) {
      room.broadcast("entity_spawn", ent);
    }

    const proto2 = getNpcPrototype(templateId) ?? getNpcPrototype(st.protoId);
    const npcName = (ent as any)?.name ?? proto2?.name ?? "Something";
    announceSpawnToRoom(ctx, roomId, `${npcName} returns.`);
  }, respawnMs);
}
