// worldcore/combat/NpcCombat.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";
import { Logger } from "../utils/logger";
import { getNpcPrototype } from "../npc/NpcTypes";
import {
  isServiceProtectedEntity,
  isServiceProtectedNpcProto,
  serviceProtectedCombatLine,
} from "./ServiceProtection";
import {
  markInCombat,
  isDeadEntity,
  applySimpleDamageToPlayer,
  computeNpcMeleeDamage,
} from "./entityCombat";
import { describeLootLine } from "../loot/lootText";
import { rollInt } from "../utils/random";
import { getItemTemplate } from "../items/ItemCatalog";
import { addItemToBags } from "../items/InventoryHelpers";
import {
  computeDamage,
  type CombatSource,
  type CombatTarget,
  type WeaponSkillId,
  type SpellSchoolId,
} from "./CombatEngine";
import type { AttackChannel } from "../actions/ActionTypes";
import {
  gainPowerResource,
  getPrimaryPowerResourceForClass,
} from "../resources/PowerResources";
import {
  gainWeaponSkill,
  gainSpellSchoolSkill,
  gainSongSchoolSkill,
  type SongSchoolId,
} from "../skills/SkillProgression";
import { computeEffectiveAttributes } from "../characters/Stats";

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
  // --- Service-provider protection: bankers/auctioneers/mailboxes etc are immune. ---
  try {
    if (isServiceProtectedEntity(npc)) {
      return serviceProtectedCombatLine(npc.name);
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

  const target: CombatTarget = {
    entity: npc,
    armor: (npc as any).armor ?? 0,
    resist: (npc as any).resist ?? {},
  };

  const result = computeDamage(source, target, {
    damageMultiplier: opts.damageMultiplier,
    flatBonus: opts.flatBonus,
  });

  // rawDamage = what CombatEngine rolled
  const rawDamage = result.damage;
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

  // --- Resource generation for the attacker (fury v1) ---
  try {
    const primaryRes = getPrimaryPowerResourceForClass(char.classId);
    if (primaryRes === "fury" && dmg > 0) {
      const gain = 5 + Math.floor(dmg / 5); // 6–15ish at low levels
      gainPowerResource(char, "fury", gain);
    }
  } catch {
    // Ditto
  }

  // --- Build combat line ---
  let tag = "[combat]";
  if (opts.abilityName) {
    const prefix = opts.tagPrefix ?? "ability";
    tag = `[${prefix}:${opts.abilityName}]`;
  }

  const overkill = rawDamage > dmg ? rawDamage - dmg : 0;

  let line = `${tag} You hit ${npc.name} for ${rawDamage} damage`;
  if (overkill > 0) {
    line += ` (${overkill} overkill)`;
  }
  line += `. (${newHp}/${maxHp} HP)`;

  if (result.wasCrit) {
    line += " (Critical hit!)";
  } else if (result.wasGlancing) {
    line += " (Glancing blow.)";
  }

  // If the NPC survives, simple counterattack and we’re done.
  if (newHp > 0) {
    const counter = applySimpleNpcCounterAttack(ctx, npc, selfEntity);
    if (counter) line += " " + counter;
    return line;
  }

  // --- NPC death: XP + loot ---
  (npc as any).alive = false;
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
        const updated = await ctx.characters.grantXp(
          userId,
          char.id,
          xpReward,
        );
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

      const tpl = getItemTemplate(entry.itemId);
      if (!tpl) {
        log.warn("Loot template missing for NPC drop", {
          itemId: entry.itemId,
          npc: npc.name,
        });
        continue;
      }

      const maxStack = tpl.maxStack ?? 1;
      const leftover = addItemToBags(inventory, entry.itemId, qty, maxStack);
      const added = qty - leftover;

      let mailed = 0;
      const overflow = leftover;

      if (overflow > 0 && ctx.mail && ctx.session.identity) {
        mailed = overflow;
        await ctx.mail.sendSystemMail(
          ctx.session.identity.userId,
          "account",
          "Overflow loot",
          `Your bags were full while looting ${npc.name}.
Extra items were delivered to your mailbox.`,
          [{ itemId: entry.itemId, qty: overflow }],
        );
      }

      if (added > 0) {
        lootLines.push(describeLootLine(entry.itemId, added, tpl.name));
      }
      if (mailed > 0) {
        lootLines.push(
          describeLootLine(entry.itemId, mailed, tpl.name) + " (via mail)",
        );
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

  if (isDeadEntity(p)) {
    return null;
  }

  // --- Coward special-case: no reactive counter-attacks ---
  try {
    if (ctx.npcs) {
      const st = ctx.npcs.getNpcStateByEntityId(npc.id);
      if (st) {
        const proto =
          getNpcPrototype(st.templateId) ?? getNpcPrototype(st.protoId);
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
    ctx.entities.get(npcEntityId)?.type === "node";

  const corpseMs = 2500;
  const respawnMs = 8000;

  // Despawn after corpse delay
  setTimeout(() => {
    const room = ctx.rooms?.get(roomId);
    room?.broadcast("entity_despawn", { id: npcEntityId });
    ctx.npcs?.despawnNpc(npcEntityId);
  }, corpseMs);

  // IMPORTANT: resources are per-player. Do NOT respawn them as shared entities here.
  if (isResource) {
    // Optional flavor text
    setTimeout(() => {
      announceSpawnToRoom(
        ctx,
        roomId,
        `Fresh ore juts from the ground nearby.`,
      );
    }, respawnMs);
    return;
  }

  // Normal NPC respawn
  setTimeout(() => {
    const deadEnt = ctx.entities?.get(npcEntityId);
    const spawnX = deadEnt?.x ?? 0;
    const spawnY = deadEnt?.y ?? 0;
    const spawnZ = deadEnt?.z ?? 0;

    const spawned = ctx.npcs?.spawnNpcById(
      templateId,
      roomId,
      spawnX,
      spawnY,
      spawnZ,
      st.variantId,
    );
    if (!spawned) return;

    const ent = ctx.entities?.get(spawned.entityId);
    const room = ctx.rooms?.get(roomId);
    if (ent && room) {
      room.broadcast("entity_spawn", ent);
    }

    const proto2 =
      getNpcPrototype(templateId) ?? getNpcPrototype(st.protoId);
    const npcName = (ent as any)?.name ?? proto2?.name ?? "Something";
    announceSpawnToRoom(ctx, roomId, `${npcName} returns.`);
  }, respawnMs);
}
