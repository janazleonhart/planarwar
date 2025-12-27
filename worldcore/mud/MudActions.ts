// worldcore/mud/MudActions.ts

import { MudContext } from "./MudContext";
import { CharacterState } from "../characters/CharacterTypes";
import { Entity } from "../shared/Entity";
import { computeEffectiveAttributes } from "../characters/Stats";
import { Logger } from "../utils/logger";
import { getNpcPrototype } from "../npc/NpcTypes";
import { markInCombat, killEntity, findNpcTargetByName, findTargetPlayerEntityByName } from "./MudHelperFunctions";
import { getTrainingDummyForRoom, computeTrainingDummyDamage, startTrainingDummyAi,
       } from "./MudTrainingDummy";
import { resolveItem } from "../items/resolveItem";
import { getItemTemplate } from "../items/ItemCatalog";
import { addItemToBags } from "../items/InventoryHelpers";
import { applyProgressionForEvent } from "./MudProgressionHooks";
import { describeLootLine, rollInt } from "./MudHelperFunctions";
import { applyProgressionEvent, setNodeDepletedUntil } from "../progression/ProgressionCore";
import { resolveTargetInRoom } from "../targeting/TargetResolver";
import { computeDamage, CombatSource, CombatTarget, WeaponSkillId, SpellSchoolId } from "../combat/CombatEngine";

import type { AttackChannel } from "../actions/ActionTypes";
import type { GatheringKind } from "../progression/ProgressEvents";
import {
  gainPowerResource,
  getPrimaryPowerResourceForClass,
} from "../resources/PowerResources";

import {
  gainWeaponSkill,
  gainSpellSchoolSkill,
} from "../skills/SkillProgression";

const log = Logger.scope("MUD");

export async function performNpcAttack(
  ctx: MudContext,
  char: CharacterState,
  selfEntity: Entity,
  npc: Entity,
  opts?: {
    abilityName?: string;
    damageMultiplier?: number;
    flatBonus?: number;
    tagPrefix?: string; // "ability" or "spell"
    channel?: AttackChannel; // NEW: default "weapon"
    weaponSkill?: WeaponSkillId; // NEW: plumb through later
    spellSchool?: SpellSchoolId; // NEW: plumb through later
  }
): Promise<string> {
    // --- Build combat source/target for CombatEngine ---
    const effective = computeEffectiveAttributes(char, ctx.items);

    const source: CombatSource = {
      char,
      effective,
      channel: opts?.channel ?? "weapon",
      weaponSkill: opts?.weaponSkill,
      spellSchool: opts?.spellSchool,
    };

    const target: CombatTarget = {
      entity: npc,
      // Later we can derive armor/resist from NPC proto
      armor: (npc as any).armor ?? 0,
      resist: (npc as any).resist ?? {},
    };

    const result = computeDamage(source, target, {
      damageMultiplier: opts?.damageMultiplier,
      flatBonus: opts?.flatBonus,
      damageSchool: opts?.spellSchool ? "arcane" : "physical", // v1 heuristic
    });

    let dmg = result.damage;
    const prevHp = npc.hp ?? npc.maxHp ?? 1;
    const maxHp = npc.maxHp ?? prevHp;
    const newHp = Math.max(0, prevHp - dmg);
    npc.hp = newHp;

    // --- Skill progression + resource gain for the attacker ---

    try {
      const channel = opts?.channel ?? "weapon";

      // Weapon / ability → bump a generic physical skill
      if (channel === "weapon" || channel === "ability") {
        // v1: treat it as one_handed until we track actual weapon types
        gainWeaponSkill(char, "one_handed", 1);
      }

      // Spell → bump its school if known
      if (channel === "spell" && opts?.spellSchool) {
        gainSpellSchoolSkill(char, opts.spellSchool, 1);
      }

      // Fury gain stays as before
      const primaryRes = getPrimaryPowerResourceForClass(char.classId);
      if (primaryRes === "fury" && dmg > 0) {
        const gain = 5 + Math.floor(dmg / 5);
        gainPowerResource(char, "fury", gain);
      }
    } catch {
      // never let progression break combat
    }

    // --- Resource generation for the attacker (fury v1) ---
    try {
      const primaryRes = getPrimaryPowerResourceForClass(char.classId);
      if (primaryRes === "fury" && dmg > 0) {
        // v1 rule: gain a bit of fury based on damage dealt
        const gain = 5 + Math.floor(dmg / 5); // 6–15ish at low levels
        gainPowerResource(char, "fury", gain);
      }
    } catch (e) {
      // don't let resource bugs break combat
    }

    let tag = "[combat]";
    if (opts?.abilityName) {
      const prefix = opts.tagPrefix ?? "ability";
      tag = `[${prefix}:${opts.abilityName}]`;
    }

    let line = `${tag} You hit ${npc.name} for ${dmg} damage. (${newHp}/${maxHp} HP)`;

    if (result.wasCrit) {
      line += " (Critical hit!)";
    } else if (result.wasGlancing) {
      line += " (Glancing blow.)";
    }

    // If the NPC survives, simple counterattack and we’re done.
    if (newHp > 0) {
      const counter = applySimpleNpcCounterAttack(ctx, npc, selfEntity);
      if (counter) {
        line += " " + counter;
      }
      return line;
    }

    // --- NPC death: XP + loot ---

    npc.alive = false;
    // Keep the hit text and append kill info
    line += ` You slay ${npc.name}!`;

  
    // Resolve prototype for rewards
    let xpReward = 10;
    let lootEntries: { itemId: string; chance: number; minQty: number; maxQty: number }[] = [];
  
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
  
    // --- Loot reward: ItemService-only (no fallback) ---

    const lootLines: string[] = [];
    let inventory = char.inventory;

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
        const leftover = addItemToBags(
          inventory,
          entry.itemId,
          qty,
          maxStack
        );

        // inventory.bags has already been mutated by addItemToBags
        const added = qty - leftover;

        let mailed = 0;
        const overflow = leftover;
        if (overflow > 0 && ctx.mail && ctx.session.identity) {
          mailed = overflow;
          await ctx.mail.sendSystemMail(
            ctx.session.identity.userId,
            "account",
            "Overflow loot",
            `Your bags were full while looting ${npc.name}. Extra items were delivered to your mailbox.`,
            [{ itemId: entry.itemId, qty: overflow }]
          );
        }

        if (added > 0) {
          lootLines.push(describeLootLine(entry.itemId, added, tpl.name));
        }
        if (mailed > 0) {
          lootLines.push(
            describeLootLine(entry.itemId, mailed, tpl.name) + " (via mail)"
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

      scheduleNpcCorpseAndRespawn(ctx, npc.id);
    }
  
    return line;
}

function applySimpleNpcCounterAttack(
    ctx: MudContext,
    npc: Entity,
    player: Entity
  ): string | null {
    const p: any = player;
    const n: any = npc;
  
    const maxHp =
      typeof p.maxHp === "number" && p.maxHp > 0 ? p.maxHp : 100;
    const hp = typeof p.hp === "number" ? p.hp : maxHp;
  
    if (hp <= 0) return null; // already dead, nothing to do
  
    // Super simple mob damage: 3–6-ish per hit at 100 HP, scales with max HP.
    const base = typeof (n as any).attackPower === "number"
      ? (n as any).attackPower
      : Math.max(1, Math.round(maxHp * 0.03)); // 3% of max HP baseline
  
    const roll = 0.8 + Math.random() * 0.4; // ±20%
    const dmg = Math.max(1, Math.floor(base * roll));
  
    const newHp = Math.max(0, hp - dmg);
    p.hp = newHp;
  
    markInCombat(p);
    markInCombat(n);
  
    if (newHp <= 0) {
      killEntity(p);
      return `[combat] ${npc.name} hits you for ${dmg} damage. You die. (0/${maxHp} HP)`;
    }
  
    return `[combat] ${npc.name} hits you for ${dmg} damage. (${newHp}/${maxHp} HP)`;
}

export function announceSpawnToRoom(ctx: MudContext, roomId: string, text: string): void {
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

// Shared attack handler used by both MUD and future action pipeline.
export async function handleAttackAction(
    ctx: MudContext,
    char: CharacterState,
    targetNameRaw: string
  ): Promise<string> {
    const targetName = targetNameRaw.toLowerCase().trim();
  
    if (!targetName) {
      return "Usage: attack <targetName>";
    }
  
    if (!ctx.entities) {
      return "Combat is not available here (no entity manager).";
    }
  
    const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
    if (!selfEntity) {
      return "You have no body here.";
    }
  
    const world = ctx.world;
    if (!world) {
      return "The world is not initialized yet.";
    }
  
    const roomId = selfEntity.roomId ?? char.shardId;
  
    // 1) Try NPC target first (rats, ore, etc.)
    const npcTarget = findNpcTargetByName(ctx.entities, roomId, targetNameRaw);
    if (npcTarget) {
      let result = await performNpcAttack(ctx, char, selfEntity, npcTarget);
    
      // If this line indicates a kill, emit the event then let the hook react.
      if (result.includes("You slay")) {
        const protoId =
          ctx.npcs?.getNpcStateByEntityId(npcTarget.id)?.protoId ?? npcTarget.name;
    
        // 1) record the kill in progression
        applyProgressionEvent(char, {
          kind: "kill",
          targetProtoId: protoId,
        });
    
        // 2) react: tasks, quests, titles, xp, DB patch
        const { snippets } = await applyProgressionForEvent(
          ctx,
          char,
          "kills",
          protoId
        );
    
        if (snippets.length > 0) {
          result += " " + snippets.join(" ");
        }
      }
    
      return result;
    }
  
    // 2) Try another player – but enforce "no PvP here" rule (for now).
    const playerTarget = findTargetPlayerEntityByName(
      ctx,
      roomId,
      targetNameRaw
    );
    if (playerTarget) {
      return "You can't attack other players here (PvP zones will come later).";
    }
  
    // 3) Fall back to training dummy logic for this room (if any).
    const dummy = getTrainingDummyForRoom(roomId);
    if (!dummy) {
      return "[combat] There is nothing here to train on.";
    }
  
    if (targetName.includes("dummy")) {
      const dummyInstance = getTrainingDummyForRoom(roomId);
      if (!dummyInstance) {
        return "[combat] There is nothing here to train on.";
      }
  
      // Tag both sides as "in combat"
      markInCombat(selfEntity);
      markInCombat(dummyInstance);
  
      // Start dummy AI for this player
      startTrainingDummyAi(ctx, ctx.session.id, roomId);
  
      const effective = computeEffectiveAttributes(char, ctx.items);
      const dmg = computeTrainingDummyDamage(effective);
  
      dummyInstance.hp = Math.max(0, dummyInstance.hp - dmg);
  
      let line: string;
      if (dummyInstance.hp > 0) {
        line =
          `[combat] You hit the Training Dummy for ${dmg} damage. ` +
          `(${dummyInstance.hp}/${dummyInstance.maxHp} HP)`;
      } else {
        line =
          `[combat] You obliterate the Training Dummy for ${dmg} damage! ` +
          `(0/${dummyInstance.maxHp} HP – it quickly knits itself back together.)`;
        dummyInstance.hp = dummyInstance.maxHp;
      }
  
      return line;
    }
  
    // 4) No valid target.
    return `There is no '${targetNameRaw}' here to attack.`;
}

export async function handleGatherAction(
  ctx: MudContext,
  char: CharacterState,
  targetNameRaw: string,
  gatheringKind: GatheringKind,
  resourceTag: string // e.g. "resource_ore", "resource_herb"
): Promise<string> {
  const what = (targetNameRaw || "").trim() || "ore";

  if (!ctx.entities || !ctx.npcs) {
    return "There is nothing here to gather.";
  }

  // TS narrowing: capture for use inside callbacks
  const npcs = ctx.npcs;
  const entities = ctx.entities;

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) {
    return "You don’t have a world entity yet.";
  }

  const roomId = selfEntity.roomId ?? char.shardId;

  const target = resolveTargetInRoom(entities, roomId, what, {
    selfId: selfEntity.id,
    filter: (e) => {
      // Absolute rule: never gather players.
      if (e.type === "player") return false;

      // Gatherables must be actual nodes/objects.
      if (e.type !== "node" && e.type !== "object") return false;

      // Gatherables spawned from DB must carry spawnPointId.
      // This prevents "mining random entities" even if state maps get polluted.
      if (typeof (e as any).spawnPointId !== "number") return false;

      // Nodes are personal (v1): only gather your own node.
      // (If you later add shared nodes, loosen this for those.)
      if ((e as any).ownerSessionId && (e as any).ownerSessionId !== ctx.session.id) return false;

      const st = npcs.getNpcStateByEntityId(e.id);
      if (!st) return false;
        const proto = getNpcPrototype(st.protoId);
        return (proto?.tags ?? []).includes(resourceTag);
      },
    });
  
  if (!target) return `There is no '${what}' here to gather.`;

  if (typeof (target as any).spawnPointId !== "number") {
    return "That isn't a real resource node.";
  }
  const npcState = ctx.npcs.getNpcStateByEntityId(target.id);
  if (!npcState) {
    return "You can’t gather that.";
  }

  const proto = getNpcPrototype(npcState.protoId);
  if (!proto || !proto.tags || !proto.tags.includes(resourceTag)) {
    return "That doesn’t look gatherable.";
  }

  // ---- NEW: generic progression event ----
  applyProgressionEvent(char, {
    kind: "harvest",
    nodeProtoId: proto.id,
    gatheringKind,
    amount: 1,
  });

  // ---- EXISTING: MUD-side tasks/quests/titles ----
  const { snippets: progressionSnippets } = await applyProgressionForEvent(
    ctx,
    char,
    "harvests",
    proto.id
  );

  // Chip away one HP/charge
  const newHp = ctx.npcs.applyDamage(target.id, 1);
  if (newHp === null) {
    return "You can’t gather that.";
  }

  const lootLines: string[] = [];

  if (!ctx.items) {
    log.warn("Gather loot skipped: ctx.items missing", {
      target: target.name,
      protoId: proto.id,
    });
  } else if (proto.loot && proto.loot.length > 0) {
    for (const entry of proto.loot) {
      const r = Math.random();
      if (r > entry.chance) continue;

      const qty = rollInt(entry.minQty, entry.maxQty);
      if (qty <= 0) continue;

      const tpl = resolveItem(ctx.items, entry.itemId);
      if (!tpl) {
        log.warn("Gather loot template missing", {
          itemId: entry.itemId,
          protoId: proto.id,
        });
        continue;
      }

      const res = ctx.items.addToInventory(char.inventory, tpl.id, qty);

      if (res.added > 0) {
        lootLines.push(describeLootLine(tpl.id, res.added, tpl.name));
      }
    }
  }

  // Persist inventory + progression changes
  ctx.session.character = char;

  if (ctx.characters) {
    try {
      await ctx.characters.saveCharacter(char);
    } catch (err) {
      log.warn("Failed to save character after gather", {
        err,
        charId: char.id,
      });
    }
  }

  let line = `[harvest] You chip away at ${target.name}.`;
  if (lootLines.length > 0) {
    line += ` You gather ${lootLines.join(", ")}.`;
  }

  if (newHp <= 0) {
    line += ` The ${target.name} is exhausted.`;
    // PERSONAL NODE BEHAVIOR:
    // If this entity is a node with a spawnPointId, deplete it for THIS character only
    // and despawn it only for the owner (owner-only visibility rules handle the rest).
    if (target.type === "node" && typeof target.spawnPointId === "number") {
      // v1 respawn timing (tune later or store per-proto/per-spawn)
      const respawnSeconds =
        gatheringKind === "mining" ? 120 :
        gatheringKind === "herbalism" ? 90 :
        120;

      setNodeDepletedUntil(char, target.spawnPointId, Date.now() + respawnSeconds * 1000);

      // Persist depletion timestamp (important for respawn correctness)
      if (ctx.characters) {
        try {
          await ctx.characters.saveCharacter(char);
        } catch (err) {
          log.warn("Failed to save character after node depletion", { err, charId: char.id });
        }
      }

      // Despawn via NPC manager so BOTH npc runtime + entity are removed.
      ctx.npcs?.despawnNpc?.(target.id);
    } else {
      // Shared NPC behavior (mobs etc.)
      scheduleNpcCorpseAndRespawn(ctx, target.id);
    }
  }

  if (progressionSnippets.length > 0) {
    line += " " + progressionSnippets.join(" ");
  }

  return line;
}

export function scheduleNpcCorpseAndRespawn(ctx: MudContext, npcEntityId: string): void {
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
    // Tell clients to remove it
    const room = ctx.rooms?.get(roomId);
    room?.broadcast("entity_despawn", { id: npcEntityId });

    ctx.npcs?.despawnNpc(npcEntityId);
  }, corpseMs);

  // IMPORTANT: resources are per-player. Do NOT respawn them as shared entities here.
  if (isResource) {
    // Optional flavor text (and this won’t create shared “ghost veins”)
    setTimeout(() => {
      announceSpawnToRoom(ctx, roomId, `Fresh ore juts from the ground nearby.`);
    }, respawnMs);
    return;
  }

  // Normal NPC respawn
  setTimeout(() => {
    // Use last known entity position (NpcRuntimeState has no x/y/z)
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
      st.variantId
    );
    if (!spawned) return;

    // Broadcast spawn with full entity so visual clients can render it
    const ent = ctx.entities?.get(spawned.entityId);
    const room = ctx.rooms?.get(roomId);
    if (ent && room) {
      room.broadcast("entity_spawn", ent);
    }

    // NpcRuntimeState has no name; use entity/prototype
    const proto = getNpcPrototype(templateId) ?? getNpcPrototype(st.protoId);
    const npcName = ent?.name ?? proto?.name ?? "Something";

    announceSpawnToRoom(ctx, roomId, `${npcName} returns.`);
  }, respawnMs);
}



