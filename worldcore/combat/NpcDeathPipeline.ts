// worldcore/combat/NpcDeathPipeline.ts
//
// Canonical NPC death pipeline used by BOTH direct attacks (performNpcAttack)
// and non-interactive damage routes (DOT ticks, hazards, etc.).
//
// Goals:
//  - Single authoritative place for: corpse state, XP rewards, loot delivery,
//    and respawn scheduling.
//  - Idempotent: safe to call multiple times for the same NPC death.
//  - Best-effort: never throw; death handling must not crash the tick loop.

import type { CharacterState } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";

import { Logger } from "../utils/logger";
import { getNpcPrototype } from "../npc/NpcTypes";
import { describeLootLine } from "../loot/lootText";
import { deliverItemToBagsOrMail } from "../loot/OverflowDelivery";
import { rollInt } from "../utils/random";
import { clearAllStatusEffectsFromEntity } from "./StatusEffects";
import { getSpawnPoint } from "../world/SpawnPointCache";

const log = Logger.scope("NPC_DEATH");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export type NpcDeathPipelineContext = {
  npcs?: any;
  entities?: any;
  rooms?: any;
  characters?: any;
  items?: any;
  mail?: any;
};

export type NpcDeathKiller = {
  session?: any;
  char?: CharacterState | null;
  selfEntity?: Entity | null;
};

export type NpcDeathResult = {
  // Human-readable suffix for MUD output.
  text: string;
  xpReward: number;
  lootLines: string[];
};

export async function handleNpcDeath(
  ctx: NpcDeathPipelineContext,
  npc: Entity,
  killer: NpcDeathKiller,
  opts?: {
    /** If true, omit XP/loot text (but still award). */
    silentText?: boolean;
  },
): Promise<NpcDeathResult> {
  // Idempotency guard: avoid double rewards if multiple systems report the same death.
  const nAny: any = npc as any;
  if (nAny._pwRewardsGranted) {
    return { text: "", xpReward: 0, lootLines: [] };
  }
  nAny._pwRewardsGranted = true;

  // Force corpse state.
  try {
    (npc as any).hp = 0;
  } catch {
    // ignore
  }

  // Death clears combat status effects so corpses don't keep ticking.
  try {
    clearAllStatusEffectsFromEntity(npc as any);
  } catch {
    // ignore
  }

  // Notify room listeners immediately (corpse state / client visuals).
  try {
    const st = ctx.npcs?.getNpcStateByEntityId?.(npc.id);
    const rid = st?.roomId ?? (npc as any)?.roomId;
    const room = rid ? ctx.rooms?.get?.(rid) : undefined;
    room?.broadcast?.("entity_update", {
      id: npc.id,
      hp: 0,
      maxHp: (npc as any)?.maxHp ?? 1,
      alive: false,
    });
  } catch {
    // ignore
  }

  // Resolve prototype for rewards.
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
    const st = ctx.npcs?.getNpcStateByEntityId?.(npc.id);
    if (st) {
      const proto = getNpcPrototype(st.protoId) ?? getNpcPrototype(st.templateId);
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
  } catch (err) {
    log.warn("Error resolving NPC prototype for rewards", {
      err,
      npcId: npc.id,
      npcName: npc.name,
    });
  }

  let text = "";
  const lootLines: string[] = [];

  // XP reward.
  try {
    const char = killer.char ?? null;
    const session = killer.session ?? null;
    const userId = session?.identity?.userId;
    if (ctx.characters && char && userId) {
      const updated = await ctx.characters.grantXp(userId, char.id, xpReward);
      if (updated) {
        // Keep caller state in sync.
        session.character = updated;
        char.level = updated.level;
        char.xp = updated.xp;
        char.attributes = updated.attributes;
        if (!opts?.silentText) {
          text += ` You gain ${xpReward} XP.`;
        }
      }
    }
  } catch (err) {
    log.warn("grantXp from NPC kill failed", {
      err,
      npcId: npc.id,
      npcName: npc.name,
    });
  }

  // Loot reward.
  try {
    const char = killer.char ?? null;
    const session = killer.session ?? null;
    if (char && lootEntries.length > 0) {
      for (const entry of lootEntries) {
        const r = Math.random();
        if (r > entry.chance) continue;

        const qty = rollInt(entry.minQty, entry.maxQty);
        if (qty <= 0) continue;

        const res = await deliverItemToBagsOrMail(
          { items: ctx.items, mail: ctx.mail, session },
          {
            itemId: entry.itemId,
            qty,
            inventory: char.inventory,
            ownerKind: "account",
            sourceName: npc.name,
            sourceVerb: "looting",
            mailSubject: "Overflow loot",
          },
        );

        if (res.added > 0) {
          lootLines.push(describeLootLine(res.itemId, res.added, res.name));
        }
        if (res.mailed > 0) {
          lootLines.push(
            describeLootLine(res.itemId, res.mailed, res.name) + " (via mail)",
          );
        }
      }

      if (lootLines.length > 0) {
        if (!opts?.silentText) {
          text += ` You loot ${lootLines.join(", ")}.`;
        }

        // Persist character if a real service exists.
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
      }
    }
  } catch (err) {
    log.warn("Loot delivery failed", {
      err,
      npcId: npc.id,
      npcName: npc.name,
    });
  }

  // Corpse + respawn.
  try {
    scheduleNpcCorpseAndRespawn(ctx, npc.id);
  } catch {
    // ignore
  }

  return { text, xpReward, lootLines };
}

/**
 * Small helper for sending “X returns.” flavor to a room.
 */
export function announceSpawnToRoom(
  ctx: NpcDeathPipelineContext,
  roomId: string,
  text: string,
): void {
  const room = ctx.rooms?.get?.(roomId);
  room?.broadcast?.("chat", {
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
  ctx: NpcDeathPipelineContext,
  npcEntityId: string,
): void {
  if (!ctx.npcs || !ctx.entities) return;

  const st = ctx.npcs.getNpcStateByEntityId?.(npcEntityId);
  if (!st) return;

  const roomId = st.roomId;
  const templateId = st.templateId;
  const protoId = st.protoId;

  // Resource detection: prefer prototype tags if available.
  const proto = getNpcPrototype(templateId) ?? getNpcPrototype(protoId);
  const isResource =
    proto?.tags?.includes("resource") ||
    proto?.tags?.some((t: string) => t.startsWith("resource_")) ||
    (ctx.entities.get(npcEntityId) as any)?.type === "node";

  // Capture spawn metadata + baseline "home" coords BEFORE corpse despawn runs.
  const ent0: any = ctx.entities.get(npcEntityId);

  // Idempotency: function may be invoked more than once for the same death.
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

  // NPC corpses need to stick around long enough for post-kill actions.
  if (!isResource) {
    corpseMs = envInt("PW_CORPSE_NPC_MS", 15000);

    // Give beasts/critter-style mobs longer since skinning is expected.
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

  // Despawn after corpse delay.
  setTimeout(() => {
    const room = ctx.rooms?.get?.(roomId);
    room?.broadcast?.("entity_despawn", { id: npcEntityId });
    ctx.npcs?.despawnNpc?.(npcEntityId);
  }, corpseMs);

  // Resources are personal/per-owner. Do NOT respawn them as shared entities here.
  if (isResource) return;

  // Normal NPC respawn.
  setTimeout(() => {
    // Consult SpawnPointCache at respawn time so late updates are honored.
    const cached =
      typeof spawnPointId === "number" ? (getSpawnPoint(spawnPointId) as any) : undefined;

    const spawnX = typeof cached?.x === "number" ? cached.x : baseSpawnX;
    const spawnY = typeof cached?.y === "number" ? cached.y : baseSpawnY;
    const spawnZ = typeof cached?.z === "number" ? cached.z : baseSpawnZ;

    const spawned = ctx.npcs?.spawnNpcById?.(
      templateId,
      roomId,
      spawnX,
      spawnY,
      spawnZ,
      st.variantId,
    );
    if (!spawned) return;

    const ent = ctx.entities?.get?.(spawned.entityId) as any;
    const room = ctx.rooms?.get?.(roomId);

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
      room.broadcast?.("entity_spawn", ent);
    }

    const proto2 = getNpcPrototype(templateId) ?? getNpcPrototype(st.protoId);
    const npcName = (ent as any)?.name ?? proto2?.name ?? "Something";
    announceSpawnToRoom(ctx, roomId, `${npcName} returns.`);
  }, respawnMs);
}
