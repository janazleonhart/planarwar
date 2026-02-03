// worldcore/combat/NpcCombat.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";
import { Logger } from "../utils/logger";
import { getNpcPrototype } from "../npc/NpcTypes";
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
import { computeEntityCombatStatusSnapshot, clearAllStatusEffectsFromEntity } from "./StatusEffects";
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
  getWeaponSkill,
  type SongSchoolId,
} from "../skills/SkillProgression";
import { computeEffectiveAttributes } from "../characters/Stats";
import { getSpawnPoint } from "../world/SpawnPointCache";
import { resolvePhysicalHit } from "./PhysicalHitResolver";
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
    let weaponSkillPoints = 0;
    try {
      weaponSkillPoints = getWeaponSkill(char, opts.weaponSkill ?? "one_handed");
    } catch {
      weaponSkillPoints = 0;
    }

    const phys = resolvePhysicalHit({
      attackerLevel: char.level ?? 1,
      defenderLevel,
      weaponSkillPoints,
      // Later: wire defenderCanBlock/parry based on proto/gear/tags
      defenderCanDodge: true,
      defenderCanParry: true,
      defenderCanBlock: true,
      allowRiposte: true,
      allowCrit: true,
      allowMultiStrike: true,
    });

    if (phys.outcome !== "hit") {
      let line = "[combat] ";
      if (phys.outcome === "miss") line += `You miss ${npc.name}.`;
      else if (phys.outcome === "dodge") line += `${npc.name} dodges your attack.`;
      else if (phys.outcome === "parry") line += `${npc.name} parries your attack.`;
      else line += `${npc.name} blocks your attack.`;

      // Parry can immediately riposte (simple counter-swing).
      if (phys.outcome === "parry" && phys.riposte) {
        const rip = applySimpleNpcCounterAttack(ctx, npc, selfEntity);
        if (rip) line += " (Riposte!) " + rip;
      }

      return line;
    }

    // Feed crit/glancing/multi-strike hints into damage computation below.
    (opts as any)._pwCritChance = phys.critChance;
    (opts as any)._pwGlancingChance = phys.glancingChance;
    (opts as any)._pwStrikes = phys.strikes;
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
  const baseRawDamage = result.damage;
  const strikes = typeof (opts as any)._pwStrikes === "number" ? (opts as any)._pwStrikes : 1;
  const rawDamage = Math.max(0, Math.floor(baseRawDamage * Math.max(1, strikes)));
  let dmg = rawDamage;

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

    // Always update threat so brains see the attacker
    ctx.npcs.recordDamage(npc.id, selfEntity.id);
  } else {
    // Legacy / test fallback with no NpcManager
    (npc as any).hp = newHp;
  }

  // --- Skill progression for the attacker ---
  try {
    const channel = opts.channel ?? "weapon";
    if (channel === "weapon" || channel === "ability") {
      // v1: treat everything as one-handed until we track real weapon types
      gainWeaponSkill(char, "one_handed", 1);
    }
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
    line = `${tag} You hit ${npc.name} for ${rawDamage} damage`;
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
    const counter = applySimpleNpcCounterAttack(ctx, npc, selfEntity);
    if (counter) line += " " + counter;
    return line;
  }

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

/**
 * Very simple NPC → player counter-attack used by all v1 brains.
 *
 * Cowards are special-cased: they never get this free swing.
 * Their only reaction should be “run away” on the next brain tick.
 */
export function applySimpleNpcCounterAttack(
  ctx: SimpleCombatContext,
  npc: Entity,
  player: Entity,
): string | null {
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

  const dmg = computeNpcMeleeDamage(npc);

  // IMPORTANT: pass the CharacterState so damageTakenPct (cowardice, curses, etc.)
  // can actually modify incoming damage.
  const char = (ctx.session?.character ?? null) as CharacterState | null;

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
