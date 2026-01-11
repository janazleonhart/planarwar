// worldcore/mud/commands/debug/handlers.ts

import { Logger } from "../../../utils/logger";
import { getStaffRole } from "../../../shared/AuthTypes";
import { logStaffAction } from "../../../auth/StaffAuditLog";
import { canGrantItemToPlayer } from "../../../items/ItemGrantRules";
import { defaultAttributes } from "../../../characters/CharacterTypes";
import {
  applySimpleDamageToPlayer,
  isDeadEntity,
} from "../../../combat/entityCombat";
import type { DamageSchool } from "../../../combat/CombatEngine";
import { SpawnPointService } from "../../../world/SpawnPointService";
import { SpawnHydrator } from "../../../world/SpawnHydrator";
import { db } from "../../../db/Database";
import { normalizeRegionIdForDb } from "../../../world/RegionFlags";
import { NpcSpawnController } from "../../../npc/NpcSpawnController";
import { announceSpawnToRoom } from "../../MudActions";
import { getSelfEntity } from "../../runtime/mudRuntime";

import { LocalSimpleAggroBrain } from "../../../ai/LocalSimpleNpcBrain";
import type { NpcPerception } from "../../../ai/NpcBrainTypes";
import {
  getNpcPrototype,
  DEFAULT_NPC_PROTOTYPES,
} from "../../../npc/NpcTypes";
export { handleDebugHydrateHere } from "./hydrateHere";



const DAMAGE_SCHOOLS: DamageSchool[] = [
  "physical",
  "arcane",
  "fire",
  "frost",
  "shadow",
  "holy",
  "nature",
  "pure",
];

function parseDamageSchool(raw: unknown): DamageSchool | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return undefined;
  return (DAMAGE_SCHOOLS as string[]).includes(s) ? (s as DamageSchool) : undefined;
}

const log = Logger.scope("MudDebug");

type MudInput = {
  cmd: string;
  args: string[];
  parts: string[];
  world?: any;
};

function requireWorld(input: MudInput): any | null {
  return input.world ?? null;
}

// ---------------------------------------------------------------------------
// Debug item + XP
// ---------------------------------------------------------------------------

export async function handleDebugGive(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const token = input.args[0];
  const qty = Math.max(1, Number(input.args[1] ?? "1") || 1);

  if (!token) return "Usage: debug_give <itemId|name> [qty]";
  if (!ctx.items) return "Item service unavailable.";
  if (!ctx.characters) return "Character service unavailable.";

  const def =
    ctx.items.get(token) ?? ctx.items.findByIdOrName?.(token);
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

export async function handleDebugXp(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const amount = Number(input.args[0] ?? "0");
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Usage: debug_xp <amount>";
  }

  if (!ctx.characters) return "Character service unavailable.";

  if (typeof ctx.characters.grantXp === "function") {
    const updated = await ctx.characters.grantXp(
      char.userId,
      char.id,
      amount
    );
    if (updated) ctx.session.character = updated;
    return `[debug] Granted ${amount} XP.`;
  }

  if (typeof ctx.characters.patchCharacter === "function") {
    await ctx.characters.patchCharacter(char.userId, char.id, {
      xp: (char.xp ?? 0) + amount,
    });
    return `[debug] Granted ${amount} XP.`;
  }

  return "XP grant is not supported by the character service.";
}

// ---------------------------------------------------------------------------
// Debug NPC spawns
// ---------------------------------------------------------------------------

export async function handleDebugSpawnNpc(
  ctx: any,
  _char: any,
  input: MudInput
): Promise<string> {
  const protoId = input.args[0];
  const variantId = input.args[1] ?? null;

  if (!protoId) {
    return "Usage: debug_spawn_npc <protoId> [variantId]";
  }

  if (!ctx.entities || !ctx.npcs) {
    return "NPC system not available.";
  }

  const selfEntity = getSelfEntity(ctx);
  if (!selfEntity || !selfEntity.roomId) {
    return "You have no room to spawn in.";
  }

  const roomId = selfEntity.roomId;
  const x = (selfEntity.x ?? 0) + 1;
  const y = selfEntity.y ?? 0;
  const z = (selfEntity.z ?? 0) + 1;

  const spawned = ctx.npcs.spawnNpcById(
    protoId,
    roomId,
    x,
    y,
    z,
    variantId
  );

  if (!spawned) {
    log.warn("debug_spawn_npc failed", {
      protoId,
      variantId,
      roomId,
    });
    return `[debug] Failed to spawn NPC '${protoId}'.`;
  }

  log.info("debug_spawn_npc", {
    protoId,
    variantId,
    roomId,
  });

  return `[debug] Spawned NPC '${protoId}' nearby.`;
}

// Spawn a Town Rat near you
export async function handleDebugSpawnRat(
  ctx: any,
  _char: any,
  _input: MudInput
): Promise<string> {
  if (!ctx.entities || !ctx.npcs) return "NPC system not available.";

  const selfEntity = getSelfEntity(ctx);
  if (!selfEntity || !selfEntity.roomId) {
    return "You have no room to spawn in.";
  }

  const x = (selfEntity.x ?? 0) + 1;
  const y = selfEntity.y ?? 0;
  const z = (selfEntity.z ?? 0) + 1;

  const npc = ctx.npcs.spawnNpcById(
    "town_rat",
    selfEntity.roomId,
    x,
    y,
    z
  );
  if (!npc) return "Failed to spawn Town Rat.";

  return "A Town Rat scurries into the room.";
}

// Spawn a small ore node near you
export async function handleDebugSpawnOre(
  ctx: any,
  _char: any,
  _input: MudInput
): Promise<string> {
  if (!ctx.entities || !ctx.npcs) return "NPC system not available.";

  const selfEntity = getSelfEntity(ctx);
  if (!selfEntity || !selfEntity.roomId) {
    return "You don’t have a world entity yet.";
  }

  const x = (selfEntity.x ?? 0) + 1;
  const y = selfEntity.y ?? 0;
  const z = (selfEntity.z ?? 0) + 1;

  const spawned = ctx.npcs.spawnNpcById(
    "ore_vein_small",
    selfEntity.roomId,
    x,
    y,
    z
  );
  if (!spawned) return "Failed to spawn ore vein.";

  return "A Hematite Ore Vein juts from the ground nearby.";
}

// Spawn based on nearby spawn_points
export async function handleDebugSpawnsHere(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const world = requireWorld(input);
  if (!world) return "The world is unavailable.";

  if (!ctx.npcs || !ctx.entities) {
    return "NPC system not available.";
  }

  // Prefer session roomId, but fall back to shardId (you used both elsewhere)
  const roomId = ctx.session.roomId ?? char.shardId;
  if (!roomId) return "You are not in a shard room.";

  const shardId = char.shardId;
  const region = world.getRegionAt(char.posX, char.posZ);
  if (!region) return "You are nowhere.";

  const radius = 64;

  // v1: instantiate each call (debug-only). If this becomes “real”, we’ll move it to ctx.
  const spawnService = new SpawnPointService();
  const controller = new NpcSpawnController({
    spawnPoints: spawnService,
    npcs: ctx.npcs,
    entities: ctx.entities,
  });

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

// Rehydrate POI-like spawn_points for your current room/region (dev-safe).
// Usage:
//   debug_rehydrate_pois            -> spawn POI placeholders
//   debug_rehydrate_pois --dry      -> show what would spawn (no changes)
export async function handleDebugRehydratePois(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const world = requireWorld(input);
  if (!world) return "The world is unavailable.";

  if (!ctx.entities) return "Entity system not available.";

  const selfEntity = getSelfEntity(ctx);
  const roomId = selfEntity?.roomId ?? ctx.session.roomId ?? char.shardId;
  if (!roomId) return "You are not in a shard room.";

  const shardId = char.shardId;
  const region = world.getRegionAt(char.posX, char.posZ);
  const regionId = region?.id ?? roomId;

  const isDry = input.args.includes("--dry") || input.args.includes("--dry-run") || input.args.includes("dry");

  const spawnService = new SpawnPointService();
  const hydrator = new SpawnHydrator(spawnService, ctx.entities);

  const res = await hydrator.rehydrateRoom({
    shardId,
    regionId,
    roomId,
    dryRun: isDry,
    force: true,
  });

  if (isDry) {
    if (res.eligible === 0) return "No POI spawn_points found for this region.";
    return `[debug] Would spawn ${res.wouldSpawn} POI(s) from spawn_points (eligible=${res.eligible}, total=${res.total}).`;
  }

  if (res.spawned === 0) {
    return res.eligible === 0
      ? "No POI spawn_points found for this region."
      : `[debug] No new POIs spawned (eligible=${res.eligible}, skippedExisting=${res.skippedExisting}).`;
  }

  announceSpawnToRoom(
    ctx,
    roomId,
    `Landmarks take shape… (${res.spawned} POI(s) rehydrated.)`
  );

  return `[debug] Rehydrated ${res.spawned} POI(s) from spawn_points (eligible=${res.eligible}, total=${res.total}).`;
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Debug region flags (DB-backed regions.flags jsonb)
// ---------------------------------------------------------------------------

export async function handleDebugRegionFlags(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const identity = ctx.session?.identity;
  if (!identity) return "You are not logged in.";

  const role = getStaffRole(identity.flags);
  const shardMode: "dev" | "live" =
    process.env.PW_SHARD_MODE === "live" ? "live" : "dev";

  // In dev, allow owner/dev/gm. In live, keep it owner-only (prevents accidents).
  if (shardMode === "live") {
    if (role !== "owner")
      return "Only the shard owner may modify region flags in live mode.";
  } else {
    if (role !== "owner" && role !== "dev" && role !== "gm") {
      return "You are not allowed to modify region flags.";
    }
  }

  // Parse optional: --shard <id>  --region <id>
  const argv = [...(input.args ?? [])].map((x) => String(x));
  function takeOpt(name: string): string | null {
    const i = argv.indexOf(name);
    if (i === -1) return null;
    const v = argv[i + 1];
    argv.splice(i, v != null ? 2 : 1);
    return v != null ? String(v) : null;
  }

  const shardOverride = takeOpt("--shard");
  const regionOverride = takeOpt("--region");

  const shardId: string =
    shardOverride ??
    char?.shardId ??
    ctx.world?.getWorldBlueprint?.()?.id ??
    "prime_shard";

  const selfEnt = ctx.entities?.getEntityByOwner?.(ctx.session?.id);
  const roomOrRegion: string | null =
    regionOverride ??
    (selfEnt?.roomId ?? null) ??
    (char?.roomId ?? null) ??
    null;

  if (!roomOrRegion) {
    return "Usage: debug_region_flags [--shard <id>] [--region <id>] [show|set|clear|reset] ...";
  }

  const regionIdDb = normalizeRegionIdForDb(roomOrRegion);
  const sub = (argv[0] ?? "show").toLowerCase();

  // Helpers
  async function fetchRow(): Promise<{ name?: string; kind?: string; flags?: any } | null> {
    const res = await db.query(
      `SELECT name, kind, flags
       FROM regions
       WHERE shard_id = $1 AND region_id = $2
       LIMIT 1`,
      [shardId, regionIdDb]
    );
    return (res.rows?.[0] as any) ?? null;
  }

  async function ensureRegionRow(): Promise<boolean> {
    const existing = await fetchRow();
    if (existing) return false;

    // If kind is an enum in your DB, grab any existing kind as a safe default.
    let defaultKind = "wilderness";
    try {
      const any = await db.query(
        `SELECT kind FROM regions WHERE shard_id = $1 LIMIT 1`,
        [shardId]
      );
      if (any.rows?.[0]?.kind) defaultKind = String(any.rows[0].kind);
    } catch {
      // ignore
    }

    const defaultName = `Region ${regionIdDb}`;

    try {
      await db.query(
        `INSERT INTO regions (shard_id, region_id, name, kind, flags)
         VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
        [shardId, regionIdDb, defaultName, defaultKind]
      );
      return true;
    } catch (err: any) {
      // If another process created it first, that's fine.
      return false;
    }
  }

  async function show(): Promise<string> {
    const row = await fetchRow();
    if (!row) return `[region_flags] No region row found for ${shardId}/${regionIdDb}. (Use: debug_region_flags set <key> <value> to auto-create it.)`;

    const flags = row.flags ?? {};
    const pretty =
      typeof flags === "object" ? JSON.stringify(flags, null, 2) : String(flags);

    return [
      `[region_flags] shard=${shardId} region=${regionIdDb}`,
      `[region_flags] name=${row.name ?? "(none)"} kind=${row.kind ?? "(none)"}`,
      `[region_flags] flags=${pretty}`,
    ].join("\n");
  }

  function parseJsonish(raw: string): any {
    const s = String(raw ?? "").trim();
    if (!s.length) return "";
    try {
      return JSON.parse(s);
    } catch {
      if (s === "true") return true;
      if (s === "false") return false;
      if (s === "null") return null;
      const n = Number(s);
      if (!Number.isNaN(n) && String(n) === s) return n;
      return s;
    }
  }

  if (sub === "show" || sub === "list") {
    return show();
  }

  if (sub === "reset") {
    const created = await ensureRegionRow();

    const res = await db.query(
      `UPDATE regions
       SET flags = '{}'::jsonb
       WHERE shard_id = $1 AND region_id = $2`,
      [shardId, regionIdDb]
    );

    await logStaffAction(identity, "region_flags_reset", { shardId, regionId: regionIdDb });

    if (!res.rowCount) {
      return `[region_flags] Failed to reset (no row) for ${shardId}/${regionIdDb}.`;
    }

    return created
      ? `[region_flags] Created region row + reset flags for ${shardId}/${regionIdDb}.`
      : `[region_flags] Reset flags for ${shardId}/${regionIdDb}.`;
  }

  if (sub === "clear") {
    const key = argv[1];
    if (!key) return "Usage: debug_region_flags clear <key> [--shard <id>] [--region <id>]";

    const created = await ensureRegionRow();

    const res = await db.query(
      `UPDATE regions
       SET flags = (COALESCE(flags, '{}'::jsonb) - $3)
       WHERE shard_id = $1 AND region_id = $2`,
      [shardId, regionIdDb, key]
    );

    await logStaffAction(identity, "region_flags_clear", { shardId, regionId: regionIdDb, key });

    if (!res.rowCount) {
      return `[region_flags] Failed to clear '${key}' (no row) for ${shardId}/${regionIdDb}.`;
    }

    return created
      ? `[region_flags] Created region row + cleared '${key}' for ${shardId}/${regionIdDb}.`
      : `[region_flags] Cleared '${key}' for ${shardId}/${regionIdDb}.`;
  }

  if (sub === "set") {
    const key = argv[1];
    const rawVal = argv.slice(2).join(" ").trim();
    if (!key || !rawVal) {
      return "Usage: debug_region_flags set <key> <jsonValue> [--shard <id>] [--region <id>]";
    }

    const created = await ensureRegionRow();

    const val = parseJsonish(rawVal);
    const valJson = JSON.stringify(val);

    const res = await db.query(
      `UPDATE regions
       SET flags = jsonb_set(COALESCE(flags, '{}'::jsonb), ARRAY[$3], $4::jsonb, true)
       WHERE shard_id = $1 AND region_id = $2`,
      [shardId, regionIdDb, key, valJson]
    );

    await logStaffAction(identity, "region_flags_set", {
      shardId,
      regionId: regionIdDb,
      key,
      value: val,
    });

    if (!res.rowCount) {
      return `[region_flags] Failed to set '${key}' (no row) for ${shardId}/${regionIdDb}.`;
    }

    return created
      ? `[region_flags] Created region row + set '${key}'=${valJson} for ${shardId}/${regionIdDb}.`
      : `[region_flags] Set '${key}'=${valJson} for ${shardId}/${regionIdDb}.`;
  }

  return "Usage: debug_region_flags [show|set|clear|reset] ...";
}


export async function handleEventGiveAny(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const itemId = input.args[0];
  const qty = Number(input.args[1] ?? "1") || 1;

  if (!itemId) return "Usage: event_give_any <itemId> [qty]";
  if (!ctx.items) return "Item service unavailable.";
  if (!ctx.characters) return "Character service unavailable.";

  const def = ctx.items.get(itemId);
  if (!def) return `Unknown item '${itemId}'.`;

  const role = getStaffRole(ctx.session.identity?.flags);
  if (role !== "owner") {
    return "Only the shard owner may use event_give_any.";
  }

  const res = ctx.items.addToInventory(char.inventory, def.id, qty);

  let mailed = 0;
  const identity = ctx.session.identity;
  if (res.leftover > 0 && ctx.mail && identity) {
    await ctx.mail.sendSystemMail(
      identity.userId,
      "account",
      "Event overflow items",
      `Your bags were full during an event.\nExtra ${def.name} copies were delivered to your mailbox.`,
      [{ itemId: def.id, qty: res.leftover }]
    );
    mailed = res.leftover;
  }

  if (res.added === 0 && mailed === 0) {
    return "Your bags are full.";
  }

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
  if (mailed > 0) {
    msg += ` ${mailed} x ${def.name} were sent to your mailbox.`;
  }
  return msg;
}

export async function handleEventMailReward(
  ctx: any,
  _char: any,
  input: MudInput
): Promise<string> {
  const token = input.args[0];
  const qty = Number(input.args[1] ?? "1") || 1;

  if (!token) return "Usage: event_mail_reward <itemId> [qty]";
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
    (ctx.items.findByIdOrName
      ? ctx.items.findByIdOrName(token)
      : undefined);
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

// ---------------------------------------------------------------------------
// More debug helpers
// ---------------------------------------------------------------------------

export async function handleDebugGiveMat(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const token = input.args[0];
  const qty = Number(input.args[1] ?? "1") || 1;

  if (!token) return "Usage: debug_give_mat <itemId|name> [qty]";
  if (!ctx.items) {
    return "Item service unavailable (ctx.items missing).";
  }
  if (!ctx.characters) {
    return "Character service unavailable (ctx.characters missing).";
  }

  const def = ctx.items.findByIdOrName?.(token);
  if (!def) return `No DB item found for '${token}'.`;

  const actorRole = getStaffRole(ctx.session.identity?.flags);
  const shardMode: "dev" | "live" =
    process.env.PW_SHARD_MODE === "live" ? "live" : "dev";

  if (!canGrantItemToPlayer({ actorRole, shardMode }, def)) {
    return `You are not allowed to grant '${def.id}'.`;
  }

  const res = ctx.items.addToInventory(char.inventory, def.id, qty);

  let mailed = 0;
  const identity = ctx.session.identity;
  if (res.leftover > 0 && ctx.mail && identity) {
    await ctx.mail.sendSystemMail(
      identity.userId,
      "account",
      "Overflow items",
      `Your bags were full while receiving ${def.name}.`,
      [{ itemId: def.id, qty: res.leftover }]
    );
    mailed = res.leftover;
  }

  if (res.added === 0 && mailed === 0) {
    return "Your bags are full.";
  }

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
  if (mailed > 0) {
    msg += ` ${mailed} x ${def.name} were sent to your mailbox.`;
  }
  return msg;
}

export async function handleDebugResetLevel(
  ctx: any,
  char: any,
  _input: MudInput
): Promise<string> {
  const userId = ctx.session.identity?.userId;
  if (!ctx.characters || !userId) {
    return "Reset is not available right now.";
  }

  const freshAttrs = defaultAttributes();
  char.level = 1;
  char.xp = 0;
  char.attributes = freshAttrs;

  ctx.session.character = char;

  try {
    await ctx.characters.saveCharacter(char);
  } catch {
    return "Failed to reset character due to a server error.";
  }

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

export async function handleDebugHurt(
  ctx: any,
  char: any,
  input: MudInput,
): Promise<string> {
  const amountRaw = input.args[0];
  const amount = Number(amountRaw ?? "0");

  const school = parseDamageSchool(input.args[1]);
  if (input.args[1] != null && !school) {
    return `[debug] Invalid school "${input.args[1]}". Valid: ${DAMAGE_SCHOOLS.join(", ")}`;
  }

  if (!amount || Number.isNaN(amount)) {
    return "[debug] Usage: debug_hurt <amount> [school]";
  }

  const selfEntity = getSelfEntity(ctx);
  if (!selfEntity) {
    return "[debug] No entity bound to your session.";
  }

  if (isDeadEntity(selfEntity)) {
    return "[debug] You are already dead.\nTry 'rest' or 'respawn' to recover.";
  }

  // Capture HP before the hit so we can report the *actual* damage
  const hpBefore =
    typeof (selfEntity as any).hp === "number" && (selfEntity as any).hp >= 0
      ? (selfEntity as any).hp
      : typeof (selfEntity as any).maxHp === "number" &&
          (selfEntity as any).maxHp > 0
      ? (selfEntity as any).maxHp
      : 100;

  const { newHp, maxHp, killed } = applySimpleDamageToPlayer(
    selfEntity,
    amount,
    char,
    school,
  );

  const actualDamage = Math.max(0, hpBefore - newHp);

  if (killed) {
    return `[combat] You take ${actualDamage} damage and die.\n(0/${
      maxHp || 0
    } HP)\n[hint] You can type 'respawn' or 'rest' to return to life.`;
  }

  return `[combat] You take ${actualDamage} damage.\n(${newHp}/${
    maxHp || "?"
  } HP)`;
}


export async function handleDebugTake(
  ctx: any,
  char: any,
  input: MudInput
): Promise<string> {
  const itemId = input.args[0];
  const qty = Number(input.args[1] ?? "1") || 1;

  if (!itemId) return "Usage: debug_take <itemId> [qty]";
  if (!ctx.items) {
    return "Item service unavailable (ctx.items missing).";
  }
  if (!ctx.characters) {
    return "Character service unavailable (ctx.characters missing).";
  }

  const res = ctx.items.removeFromInventory(
    char.inventory,
    itemId,
    qty
  );
  if (res.removed === 0) {
    return "You don't have that item.";
  }

  await ctx.characters.saveCharacter(char);

  let msg = `Removed ${itemId} x${res.removed}.`;
  if (res.leftover > 0) {
    msg += ` (Short by ${res.leftover}.)`;
  }
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

export async function handleDebugNpcAi(
  ctx: any,
  char: any,
  input: MudInput,
): Promise<string> {
  if (!ctx.entities || !ctx.npcs) {
    return "NPC/Entity system not available.";
  }

  const roomId = ctx.session.roomId ?? char.shardId;
  if (!roomId) {
    return "You are not in a shard room.";
  }

  const entitiesInRoom = ctx.entities.getEntitiesInRoom(roomId) as any[];
  const npcEntities = entitiesInRoom.filter(
    (e) => e.type === "npc" || e.type === "node",
  );

  if (npcEntities.length === 0) {
    return "[ai] No NPCs or nodes in this room.";
  }

  const query = (input.args[0] ?? "").toLowerCase().trim();

  let npcEntity: any | undefined;

  if (query) {
    // If user supplied a filter, prefer that
    npcEntity =
      npcEntities.find((e) =>
        String(e.name ?? "")
          .toLowerCase()
          .includes(query),
      ) ??
      npcEntities.find((e) =>
        String((e as any).protoId ?? "")
          .toLowerCase()
          .includes(query),
      );
  } else {
    // No filter: prefer an NPC that is currently in combat
    npcEntity =
      npcEntities.find((e) => (e as any).inCombat) ?? npcEntities[0];
  }

  if (!npcEntity) {
    return query
      ? `[ai] No NPC matching '${query}' in this room.`
      : "[ai] No suitable NPC found in this room.";
  }

  const npcState =
    ctx.npcs.getNpcStateByEntityId?.(npcEntity.id) ??
    ctx.npcs.getNpcStateByEntityId?.(npcEntity.entityId);

  if (!npcState) {
    return "[ai] NPC runtime state not found for that entity.";
  }

  let proto =
    getNpcPrototype(npcState.templateId) ??
    getNpcPrototype(npcState.protoId) ??
    DEFAULT_NPC_PROTOTYPES[npcState.templateId] ??
    DEFAULT_NPC_PROTOTYPES[npcState.protoId];

  if (!proto) {
    return "[ai] No NPC prototype found (DB + defaults).";
  }

  const tags = proto.tags ?? [];
  const isResource =
    tags.includes("resource") ||
    tags.some((t: string) => t.startsWith("resource_"));
  const nonHostile = tags.includes("non_hostile") || isResource;
  const behavior = proto.behavior ?? "aggressive";
  const hostile =
    !nonHostile &&
    (behavior === "aggressive" ||
      behavior === "guard" ||
      behavior === "coward");

  const playersInRoom: {
    entityId: string;
    characterId?: string;
    hp: number;
    maxHp: number;
  }[] = [];

  for (const ent of entitiesInRoom as any[]) {
    if (ent.type !== "player") continue;

    const maxHp =
      typeof ent.maxHp === "number" && ent.maxHp > 0 ? ent.maxHp : 100;
    const hp =
      typeof ent.hp === "number" && ent.hp >= 0 ? ent.hp : maxHp;

    playersInRoom.push({
      entityId: ent.id,
      characterId: ent.characterId,
      hp,
      maxHp,
    });
  }

  const perception: NpcPerception = {
    npcId: npcState.entityId,
    entityId: npcState.entityId,
    roomId,
    hp: npcState.hp,
    maxHp: npcState.maxHp,
    alive: npcState.alive,
    behavior,
    hostile,
    currentTargetId: undefined,
    playersInRoom,
    sinceLastDecisionMs: 0,
  };

  const brain = new LocalSimpleAggroBrain();
  const decision = brain.decide(perception, 0);

  const lines: string[] = [];

  lines.push(
    `[ai] NPC: ${proto.name} (${npcState.protoId} / template=${npcState.templateId})`,
  );
  lines.push(
    `[ai] Room: ${roomId} HP: ${npcState.hp}/${npcState.maxHp} alive=${npcState.alive} fleeing=${!!npcState.fleeing}`,
  );
  lines.push(
    `[ai] Behavior: ${behavior} hostile=${hostile} tags=[${tags.join(", ")}]`,
  );
  lines.push(
    `[ai] Players in room: ${playersInRoom.length}${
      playersInRoom.length > 0
        ? ` (first=${playersInRoom[0].entityId} hp=${playersInRoom[0].hp}/${playersInRoom[0].maxHp})`
        : ""
    }`,
  );

  if (!decision) {
    lines.push("[ai] Decision: none (idle / on cooldown / non-hostile).");
  } else {
    switch (decision.kind) {
      case "attack_entity":
        lines.push(
          `[ai] Decision: attack_entity → ${decision.targetEntityId} (style=${
            decision.attackStyle ?? "melee"
          })`,
        );
        break;
      case "flee":
        lines.push(
          `[ai] Decision: flee${
            decision.fromEntityId ? ` from ${decision.fromEntityId}` : ""
          }`,
        );
        break;
      case "move_to_room":
        lines.push(`[ai] Decision: move_to_room → ${decision.roomId}`);
        break;
      case "say":
        lines.push(`[ai] Decision: say → "${decision.text}"`);
        break;
      case "idle":
      default:
        lines.push("[ai] Decision: idle.");
        break;
    }
  }

  return lines.join("\n");
}