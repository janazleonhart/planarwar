// worldcore/mud/commands/debug/handlers.ts

import { Logger } from "../../../utils/logger";
import { getStaffRole } from "../../../shared/AuthTypes";
import { logStaffAction } from "../../../auth/StaffAuditLog";
import { canGrantItemToPlayer } from "../../../items/ItemGrantRules";
import { defaultAttributes } from "../../../characters/CharacterTypes";
import { applySimpleDamageToPlayer, isDeadEntity } from "../../../combat/entityCombat";
import { SpawnPointService } from "../../../world/SpawnPointService";
import { NpcSpawnController } from "../../../npc/NpcSpawnController";
import { announceSpawnToRoom } from "../../MudActions";
import { getSelfEntity } from "../../runtime/mudRuntime"

const log = Logger.scope("MudDebug");

type MudInput = { cmd: string; args: string[]; parts: string[]; world?: any };

function requireWorld(input: MudInput): any | null {
  return input.world ?? null;
}

export async function handleDebugGive(ctx: any, char: any, input: MudInput): Promise<string> {
  const token = input.args[0];
  const qty = Math.max(1, Number(input.args[1] ?? "1") || 1);

  if (!token) return "Usage: debug_give <itemIdOrName> [qty]";
  if (!ctx.items) return "Item service unavailable.";
  if (!ctx.characters) return "Character service unavailable.";

  const def = ctx.items.get(token) ?? ctx.items.findByIdOrName?.(token);
  if (!def) return `No DB item found for '${token}'.`;

  const res = ctx.items.addToInventory(char.inventory, def.id, qty);

  // overflow → mail (optional)
  if (res.leftover > 0 && ctx.mail && ctx.session?.identity) {
    await ctx.mail.sendSystemMail(
      ctx.session.identity.userId,
      "account",
      "Debug item overflow",
      `Your bags were full; ${res.leftover}x ${def.name} was mailed to you.`,
      [{ itemId: def.id, qty: res.leftover }]
    );
  }

  await ctx.characters.saveCharacter(char);

  let msg = `[debug] Gave ${res.added}x ${def.name}.`;
  if (res.leftover > 0) msg += ` (${res.leftover}x mailed)`;
  return msg;
}

export async function handleDebugXp(ctx: any, char: any, input: MudInput): Promise<string> {
  const amount = Number(input.args[0] ?? "0");
  if (!Number.isFinite(amount) || amount <= 0) return "Usage: debug_xp <amount>";
  if (!ctx.characters) return "Character service unavailable.";

  if (typeof ctx.characters.grantXp === "function") {
    const updated = await ctx.characters.grantXp(char.userId, char.id, amount);
    if (updated) ctx.session.character = updated;
    return `[debug] Granted ${amount} XP.`;
  }

  // fallback: patch (if your char service supports it)
  if (typeof ctx.characters.patchCharacter === "function") {
    await ctx.characters.patchCharacter(char.userId, char.id, { xp: (char.xp ?? 0) + amount });
    return `[debug] Granted ${amount} XP.`;
  }

  return "XP grant is not supported by the character service.";
}

export async function handleDebugSpawnNpc(ctx: any, char: any, input: MudInput): Promise<string> {
  // You can wire this once we confirm the NPC/entity APIs you want.
  // For now, keep it as a safe NYI so registry compiles.
  const protoId = input.args[0];
  if (!protoId) return "Usage: debug_spawn_npc <protoId> [name]";
  log.warn("debug_spawn_npc NYI", { protoId, charId: char.id });
  return "[debug] debug_spawn_npc is NYI (spawn system not wired here yet).";
}

export async function handleEventGiveAny(ctx: any, char: any, input: MudInput): Promise<string> {
  const itemId = input.args[0];
  const qty = Number(input.args[1] ?? "1") || 1;

  if (!itemId) return "Usage: event_give_any <itemId> [qty]";
  if (!ctx.items) return "Item service unavailable.";
  if (!ctx.characters) return "Character service unavailable.";

  const def = ctx.items.get(itemId);
  if (!def) return `Unknown item '${itemId}'.`;

  const role = getStaffRole(ctx.session.identity?.flags);

  // Hard lock: only owner
  if (role !== "owner") return "Only the shard owner may use event_give_any.";

  const res = ctx.items.addToInventory(char.inventory, def.id, qty);

  let mailed = 0;
  const identity = ctx.session.identity;
  if (res.leftover > 0 && ctx.mail && identity) {
    await ctx.mail.sendSystemMail(
      identity.userId,
      "account",
      "Event overflow items",
      `Your bags were full during an event. Extra ${def.name} copies were delivered to your mailbox.`,
      [{ itemId: def.id, qty: res.leftover }]
    );
    mailed = res.leftover;
  }

  if (res.added === 0 && mailed === 0) return "Your bags are full.";

  await ctx.characters.saveCharacter(char);

  await logStaffAction(ctx.session.identity, "event_give_any", {
    targetCharacterId: char.id,
    targetCharacterName: char.name,
    itemId: def.id,
    itemName: def.name,
    requestedQty: qty,
    grantedQty: res.added,
    leftover: res.leftover,
    mailed,
  });

  let msg = `[EVENT] You receive ${res.added} x ${def.name}.`;
  if (mailed > 0) msg += ` ${mailed} x ${def.name} were sent to your mailbox.`;
  return msg;
}

export async function handleEventMailReward(ctx: any, _char: any, input: MudInput): Promise<string> {
  const token = input.args[0];
  const qty = Number(input.args[1] ?? "1") || 1;

  if (!token) return "Usage: event_mail_reward <itemIdOrName> [qty]";
  if (!ctx.mail) return "Mail service unavailable.";
  if (!ctx.items) return "Item service unavailable.";

  const identity = ctx.session.identity;
  if (!identity) return "You are not logged in.";

  const role = getStaffRole(identity.flags);
  if (role !== "owner" && role !== "dev" && role !== "gm") {
    return "You are not allowed to send event reward mail.";
  }

  const def =
    ctx.items.get(token) ??
    (ctx.items.findByIdOrName ? ctx.items.findByIdOrName(token) : undefined);

  if (!def) return `No DB item found for '${token}'.`;

  await ctx.mail.sendSystemMail(
    identity.userId,
    "account",
    "Event Reward",
    `Thank you for participating in an event.\nYou have been awarded ${qty}x ${def.name}.`,
    [{ itemId: def.id, qty }]
  );

  await logStaffAction(ctx.session.identity, "event_mail_reward", {
    targetAccountId: identity.userId,
    targetDisplayName: identity.displayName,
    itemId: def.id,
    itemName: def.name,
    qty,
  });

  return `Event reward mailed: ${qty} x ${def.name}.`;
}

export async function handleDebugGiveMat(ctx: any, char: any, input: MudInput): Promise<string> {
  const token = input.args[0];
  const qty = Number(input.args[1] ?? "1") || 1;

  if (!token) return "Usage: debug_give_mat <itemIdOrName> [qty]";
  if (!ctx.items) return "Item service unavailable (ctx.items missing).";
  if (!ctx.characters) return "Character service unavailable (ctx.characters missing).";

  const def = ctx.items.findByIdOrName?.(token);
  if (!def) return `No DB item found for '${token}'.`;

  const actorRole = getStaffRole(ctx.session.identity?.flags);
  const shardMode: "dev" | "live" = process.env.PW_SHARD_MODE === "live" ? "live" : "dev";

  if (!canGrantItemToPlayer({ actorRole, shardMode }, def)) {
    return `You are not allowed to grant '${def.id}'.`;
  }

  const res = ctx.items.addToInventory(char.inventory, def.id, qty);

  // overflow → mail if possible
  let mailed = 0;
  const identity = ctx.session.identity;
  if (res.leftover > 0 && ctx.mail && identity) {
    await ctx.mail.sendSystemMail(
      identity.userId,
      "account",
      "Overflow items",
      `Your bags were full while receiving ${def.name}. Extra copies were delivered to your mailbox.`,
      [{ itemId: def.id, qty: res.leftover }]
    );
    mailed = res.leftover;
  }

  if (res.added === 0 && mailed === 0) return "Your bags are full.";

  await ctx.characters.saveCharacter(char);

  await logStaffAction(ctx.session.identity, "debug_give_mat", {
    targetCharacterId: char.id,
    targetCharacterName: char.name,
    itemId: def.id,
    itemName: def.name,
    requestedQty: qty,
    grantedQty: res.added,
    leftover: res.leftover,
    mailed,
  });

  let msg = `You receive ${res.added} x ${def.name} (DB item).`;
  if (mailed > 0) msg += ` ${mailed} x ${def.name} were sent to your mailbox.`;
  return msg;
}

export async function handleDebugResetLevel(ctx: any, char: any, _input: MudInput): Promise<string> {
  const userId = ctx.session.identity?.userId;
  if (!ctx.characters || !userId) return "Reset is not available right now.";

  const freshAttrs = defaultAttributes();

  char.level = 1;
  char.xp = 0;
  char.attributes = freshAttrs;

  // session points at this state
  ctx.session.character = char;

  try {
    await ctx.characters.saveCharacter(char);
  } catch (err) {
    // use your logger if you want; keeping safe + minimal
    return "Failed to reset character due to a server error.";
  }

  // If entity exists, restore hp baseline
  const entities = ctx.entities;
  if (entities) {
    const selfEntity = entities.getEntityByOwner?.(ctx.session.id);
    if (selfEntity) {
      selfEntity.maxHp = 100;
      selfEntity.hp = selfEntity.maxHp;
    }
  }

  await logStaffAction(ctx.session.identity, "debug_reset_level", {
    targetCharacterId: char.id,
    targetCharacterName: char.name,
    level: 1,
  });

  return "Character reset to level 1 with baseline attributes.";
}

export async function handleDebugHurt(ctx: any, _char: any, input: MudInput): Promise<string> {
  const amountRaw = input.args[0];
  const amount = Number(amountRaw ?? "0");

  if (!amount || Number.isNaN(amount)) {
    return "[debug] Usage: debug_hurt <amount>";
  }

  const selfEntity = getSelfEntity(ctx);
  if (!selfEntity) return "[debug] No entity bound to your session.";

  if (isDeadEntity(selfEntity)) {
    return "[debug] You are already dead. Try 'rest' or 'respawn' to recover.";
  }

  const { newHp, maxHp, killed } = applySimpleDamageToPlayer(selfEntity, amount);

  if (killed) {
    return `[combat] You take ${amount} damage and die. (0/${maxHp || 0} HP)\n[hint] You can type 'respawn' or 'rest' to return to life.`;
  }

  return `[combat] You take ${amount} damage. (${newHp}/${maxHp || "?"} HP)`;
}

export async function handleDebugSpawnRat(ctx: any, _char: any, _input: MudInput): Promise<string> {
  if (!ctx.entities || !ctx.npcs) return "NPC system not available.";

  const selfEntity = getSelfEntity(ctx);
  if (!selfEntity || !selfEntity.roomId) return "You have no room to spawn in.";

  // Put it near you if coords exist; otherwise 0s.
  const x = (selfEntity.x ?? 0) + 1;
  const y = selfEntity.y ?? 0;
  const z = (selfEntity.z ?? 0) + 1;

  const npc = ctx.npcs.spawnNpcById("town_rat", selfEntity.roomId, x, y, z);
  if (!npc) return "Failed to spawn Town Rat.";

  return "A Town Rat scurries into the room.";
}

export async function handleDebugSpawnOre(ctx: any, _char: any, _input: MudInput): Promise<string> {
  if (!ctx.entities || !ctx.npcs) return "NPC system not available.";

  const selfEntity = getSelfEntity(ctx);
  if (!selfEntity || !selfEntity.roomId) return "You don’t have a world entity yet.";

  const x = (selfEntity.x ?? 0) + 1;
  const y = selfEntity.y ?? 0;
  const z = (selfEntity.z ?? 0) + 1;

  const spawned = ctx.npcs.spawnNpcById("ore_vein_small", selfEntity.roomId, x, y, z);
  if (!spawned) return "Failed to spawn ore vein.";

  return "A Hematite Ore Vein juts from the ground nearby.";
}

export async function handleDebugSpawnsHere(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const world = requireWorld(input);
  if (!world) return "The world is unavailable.";
  if (!ctx.npcs) return "NPC system not available.";

  // Prefer session roomId, but fall back to shardId (you used both elsewhere)
  const roomId = ctx.session.roomId ?? char.shardId;
  if (!roomId) return "You are not in a shard room.";

  const shardId = char.shardId;
  const region = world.getRegionAt(char.posX, char.posZ);
  if (!region) return "You are nowhere.";

  const radius = 64;

  // v1: instantiate each call (debug-only). If this becomes “real”, we’ll move it to ctx.
  const spawnService = new SpawnPointService();
  const controller = new NpcSpawnController(spawnService, ctx.npcs);

  const count = await controller.spawnNear(
    shardId,
    char.posX,
    char.posZ,
    radius,
    roomId
  );

  if (count === 0) return "No spawn_points found near you.";

  // Nice room flavor (and makes it obvious it worked)
  announceSpawnToRoom(
    ctx,
    roomId,
    `The area feels more alive… (${count} spawn(s) emerge from the world.)`
  );

  return `Spawned ${count} NPCs/nodes from spawn_points.`;
}

export async function handleDebugTake(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const itemId = input.args[0];
  const qty = Number(input.args[1] ?? "1") || 1;

  if (!itemId) return "Usage: debug_take <itemId> [qty]";
  if (!ctx.items) return "Item service unavailable (ctx.items missing).";
  if (!ctx.characters) return "Character service unavailable (ctx.characters missing).";

  const res = ctx.items.removeFromInventory(char.inventory, itemId, qty);
  if (res.removed === 0) return "You don't have that item.";

  await ctx.characters.saveCharacter(char);

  let msg = `Removed ${itemId} x${res.removed}.`;
  if (res.leftover > 0) msg += ` (Short by ${res.leftover}.)`;
  return msg;
}

export async function handleDebugMailTest(
  ctx: any,
  _char: any,
  _input: MudInput
): Promise<string> {
  if (!ctx.mail) return "Mail service unavailable.";

  const identity = ctx.session.identity;
  if (!identity) return "No identity.";

  await ctx.mail.sendSystemMail(
    identity.userId,
    "account",
    "Welcome to Planar Mail",
    "This is a test system mail.",
    [{ itemId: "herb_peacebloom", qty: 3 }]
  );

  return "Test mail sent.";
}