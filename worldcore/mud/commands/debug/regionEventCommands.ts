// worldcore/mud/commands/debug/regionEventCommands.ts
//
// Convenience helpers for toggling region-level event & PvP flags in the DB.
// These are *debug* commands (staff-gated via withDebugGate in registry.ts).
//
// Backed by regions.flags JSONB. If the region row doesn't exist yet, these
// commands will create a minimal stub row (name/kind/flags).

import { db } from "../../../db/Database";
import { Logger } from "../../../utils/logger";
import { logStaffAction } from "../../../auth/StaffAuditLog";
import { normalizeRegionIdForDb } from "../../../world/RegionFlags";

const log = Logger.scope("REGION_EVENT_DEBUG");

type MudInput = {
  cmd: string;
  args: string[];
  parts: string[];
  world?: any;
};

type RegionRow = {
  name?: string;
  kind?: string;
  flags?: any;
} | null;

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

function takeOpt(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1];
  argv.splice(i, v != null ? 2 : 1);
  return v != null ? String(v) : null;
}

function resolveShardAndRegion(
  ctx: any,
  char: any,
  argv: string[]
): { shardId: string; regionIdDb: string } | null {
  const shardOverride = takeOpt(argv, "--shard");
  const regionOverride = takeOpt(argv, "--region");

  const shardId: string =
    shardOverride ??
    char?.shardId ??
    ctx.world?.getWorldBlueprint?.()?.id ??
    "prime_shard";

  const selfEnt = ctx.entities?.getEntityByOwner?.(ctx.session?.id);
  const roomOrRegion: string | null =
    regionOverride ??
    selfEnt?.roomId ??
    char?.roomId ??
    null;

  if (!roomOrRegion) return null;

  const regionIdDb = normalizeRegionIdForDb(roomOrRegion);
  return { shardId, regionIdDb };
}

async function fetchRegionRow(shardId: string, regionIdDb: string): Promise<RegionRow> {
  const res = await db.query(
    `SELECT name, kind, flags
     FROM regions
     WHERE shard_id = $1 AND region_id = $2
     LIMIT 1`,
    [shardId, regionIdDb]
  );
  return (res.rows?.[0] as any) ?? null;
}

async function ensureRegionRow(shardId: string, regionIdDb: string): Promise<boolean> {
  const existing = await fetchRegionRow(shardId, regionIdDb);
  if (existing) return false;

  // If kind is an enum in your DB, reuse an existing value as a safe default.
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
    log.debug(`ensureRegionRow: ${err?.message || String(err)}`);
    return false;
  }
}

async function jsonbSetKey(
  shardId: string,
  regionIdDb: string,
  key: string,
  value: any
): Promise<number> {
  const valJson = JSON.stringify(value);
  const res = await db.query(
    `UPDATE regions
     SET flags = jsonb_set(COALESCE(flags, '{}'::jsonb), ARRAY[$3], $4::jsonb, true)
     WHERE shard_id = $1 AND region_id = $2`,
    [shardId, regionIdDb, key, valJson]
  );
  return res.rowCount ?? 0;
}

async function jsonbRemoveKey(
  shardId: string,
  regionIdDb: string,
  key: string
): Promise<number> {
  const res = await db.query(
    `UPDATE regions
     SET flags = (COALESCE(flags, '{}'::jsonb) - $3)
     WHERE shard_id = $1 AND region_id = $2`,
    [shardId, regionIdDb, key]
  );
  return res.rowCount ?? 0;
}

function fmtFlags(flags: any): string {
  if (flags && typeof flags === "object") return JSON.stringify(flags, null, 2);
  if (flags == null) return "{}";
  return String(flags);
}

// ---------------------------------------------------------------------------
// debug_region_event
//
// Usage:
//   debug_region_event                         (show)
//   debug_region_event show
//   debug_region_event invasion <id> [--danger 1.25] [--pvp] [--tags ["a","b"]]
//   debug_region_event warfront <id> [--danger 1.25] [--tags ["a","b"]]
//   debug_region_event seasonal <id> [--tags ["a","b"]]
//   debug_region_event off
//
// Notes:
// - invasion does NOT imply PvP unless you pass --pvp.
// - warfront DOES enable PvP + sets pvpMode="warfront" and warfrontId=<id>.
// - off clears: eventEnabled/eventId/eventKind/eventTags/dangerScalar (does not touch PvP keys).
// ---------------------------------------------------------------------------
export async function handleDebugRegionEvent(ctx: any, char: any, input: MudInput): Promise<string> {
  const identity = ctx.session?.identity;
  if (!identity) return "You are not logged in.";

  const argv = [...(input.args ?? [])].map((x) => String(x));
  const sub = (argv.shift() ?? "show").toLowerCase();

  const loc = resolveShardAndRegion(ctx, char, argv);
  if (!loc) return "Usage: debug_region_event [--shard <id>] [--region <id>] ... (must be in a room/region)";

  const { shardId, regionIdDb } = loc;

  // Options
  const dangerRaw = takeOpt(argv, "--danger");
  const tagsRaw = takeOpt(argv, "--tags");
  const pvpFlag = argv.includes("--pvp");
  if (pvpFlag) argv.splice(argv.indexOf("--pvp"), 1);

  if (sub === "show" || sub === "list") {
    const row = await fetchRegionRow(shardId, regionIdDb);
    if (!row) return `[region_event] No region row for ${shardId}/${regionIdDb}.`;
    const flags = row.flags ?? {};
    const summary = {
      eventEnabled: flags.eventEnabled ?? false,
      eventKind: flags.eventKind ?? null,
      eventId: flags.eventId ?? null,
      eventTags: flags.eventTags ?? null,
      dangerScalar: flags.dangerScalar ?? 1,
      pvpEnabled: flags.pvpEnabled ?? false,
      pvpMode: flags.pvpMode ?? null,
      warfrontId: flags.warfrontId ?? null,
    };
    return `[region_event] ${shardId}/${regionIdDb}\n${JSON.stringify(summary, null, 2)}`;
  }

  if (sub === "off" || sub === "stop" || sub === "end") {
    const created = await ensureRegionRow(shardId, regionIdDb);

    // Clear event-related keys.
    await jsonbRemoveKey(shardId, regionIdDb, "eventEnabled");
    await jsonbRemoveKey(shardId, regionIdDb, "eventKind");
    await jsonbRemoveKey(shardId, regionIdDb, "eventId");
    await jsonbRemoveKey(shardId, regionIdDb, "eventTags");
    await jsonbRemoveKey(shardId, regionIdDb, "dangerScalar");

    await logStaffAction(identity, "region_event_off", {
      shardId,
      regionId: regionIdDb,
    });

    return created
      ? `[region_event] Created region row + cleared event flags for ${shardId}/${regionIdDb}.`
      : `[region_event] Cleared event flags for ${shardId}/${regionIdDb}.`;
  }

  // Kind commands: invasion/warfront/seasonal/start
  let kind = sub;
  let eventId: string | undefined;

  if (sub === "start") {
    kind = String(argv.shift() ?? "").toLowerCase();
    eventId = String(argv.shift() ?? "");
  } else {
    eventId = String(argv.shift() ?? "");
  }

  if (!kind || !eventId) {
    return "Usage: debug_region_event invasion|warfront|seasonal <id> [--danger N] [--pvp] [--tags JSON]";
  }

  const dangerScalar = dangerRaw != null ? Number(dangerRaw) : null;
  const tags = tagsRaw != null ? parseJsonish(tagsRaw) : null;

  const created = await ensureRegionRow(shardId, regionIdDb);

  // eventEnabled + eventKind + eventId
  await jsonbSetKey(shardId, regionIdDb, "eventEnabled", true);
  await jsonbSetKey(shardId, regionIdDb, "eventKind", kind);
  await jsonbSetKey(shardId, regionIdDb, "eventId", eventId);

  if (tags != null && tags !== "") {
    await jsonbSetKey(shardId, regionIdDb, "eventTags", tags);
  }

  if (dangerScalar != null && Number.isFinite(dangerScalar)) {
    await jsonbSetKey(shardId, regionIdDb, "dangerScalar", dangerScalar);
  }

  // warfront implies PvP
  if (kind === "warfront") {
    await jsonbSetKey(shardId, regionIdDb, "pvpEnabled", true);
    await jsonbSetKey(shardId, regionIdDb, "pvpMode", "warfront");
    await jsonbSetKey(shardId, regionIdDb, "warfrontId", eventId);
  } else if (pvpFlag) {
    await jsonbSetKey(shardId, regionIdDb, "pvpEnabled", true);
    await jsonbSetKey(shardId, regionIdDb, "pvpMode", "open");
  }

  await logStaffAction(identity, "region_event_set", {
    shardId,
    regionId: regionIdDb,
    kind,
    eventId,
    dangerScalar,
    pvp: kind === "warfront" ? "warfront" : pvpFlag ? "open" : "unchanged",
  });

  const row = await fetchRegionRow(shardId, regionIdDb);
  return created
    ? `[region_event] Created region row + set event '${kind}:${eventId}' for ${shardId}/${regionIdDb}.\nflags=${fmtFlags(row?.flags)}`
    : `[region_event] Set event '${kind}:${eventId}' for ${shardId}/${regionIdDb}.\nflags=${fmtFlags(row?.flags)}`;
}

// ---------------------------------------------------------------------------
// debug_region_pvp
//
// Usage:
//   debug_region_pvp show
//   debug_region_pvp on
//   debug_region_pvp off
//   debug_region_pvp warfront <id>
// ---------------------------------------------------------------------------
export async function handleDebugRegionPvp(ctx: any, char: any, input: MudInput): Promise<string> {
  const identity = ctx.session?.identity;
  if (!identity) return "You are not logged in.";

  const argv = [...(input.args ?? [])].map((x) => String(x));
  const sub = (argv.shift() ?? "show").toLowerCase();

  const loc = resolveShardAndRegion(ctx, char, argv);
  if (!loc) return "Usage: debug_region_pvp [--shard <id>] [--region <id>] ... (must be in a room/region)";

  const { shardId, regionIdDb } = loc;

  if (sub === "show" || sub === "list") {
    const row = await fetchRegionRow(shardId, regionIdDb);
    if (!row) return `[region_pvp] No region row for ${shardId}/${regionIdDb}.`;
    const flags = row.flags ?? {};
    const summary = {
      pvpEnabled: flags.pvpEnabled ?? false,
      pvpMode: flags.pvpMode ?? null,
      warfrontId: flags.warfrontId ?? null,
      friendlyFireGuild: flags.friendlyFireGuild ?? false,
    };
    return `[region_pvp] ${shardId}/${regionIdDb}\n${JSON.stringify(summary, null, 2)}`;
  }

  const created = await ensureRegionRow(shardId, regionIdDb);

  if (sub === "on" || sub === "open") {
    await jsonbSetKey(shardId, regionIdDb, "pvpEnabled", true);
    await jsonbSetKey(shardId, regionIdDb, "pvpMode", "open");
    await jsonbRemoveKey(shardId, regionIdDb, "warfrontId");

    await logStaffAction(identity, "region_pvp_on", { shardId, regionId: regionIdDb });

    const row = await fetchRegionRow(shardId, regionIdDb);
    return created
      ? `[region_pvp] Created region row + PvP enabled for ${shardId}/${regionIdDb}.\nflags=${fmtFlags(row?.flags)}`
      : `[region_pvp] PvP enabled for ${shardId}/${regionIdDb}.\nflags=${fmtFlags(row?.flags)}`;
  }

  if (sub === "off" || sub === "disabled") {
    await jsonbSetKey(shardId, regionIdDb, "pvpEnabled", false);
    await jsonbRemoveKey(shardId, regionIdDb, "pvpMode");
    await jsonbRemoveKey(shardId, regionIdDb, "warfrontId");

    await logStaffAction(identity, "region_pvp_off", { shardId, regionId: regionIdDb });

    const row = await fetchRegionRow(shardId, regionIdDb);
    return created
      ? `[region_pvp] Created region row + PvP disabled for ${shardId}/${regionIdDb}.\nflags=${fmtFlags(row?.flags)}`
      : `[region_pvp] PvP disabled for ${shardId}/${regionIdDb}.\nflags=${fmtFlags(row?.flags)}`;
  }

  if (sub === "warfront") {
    const id = String(argv.shift() ?? "");
    if (!id) return "Usage: debug_region_pvp warfront <id>";

    await jsonbSetKey(shardId, regionIdDb, "pvpEnabled", true);
    await jsonbSetKey(shardId, regionIdDb, "pvpMode", "warfront");
    await jsonbSetKey(shardId, regionIdDb, "warfrontId", id);

    await logStaffAction(identity, "region_pvp_warfront", {
      shardId,
      regionId: regionIdDb,
      warfrontId: id,
    });

    const row = await fetchRegionRow(shardId, regionIdDb);
    return created
      ? `[region_pvp] Created region row + warfront PvP enabled (${id}) for ${shardId}/${regionIdDb}.\nflags=${fmtFlags(row?.flags)}`
      : `[region_pvp] Warfront PvP enabled (${id}) for ${shardId}/${regionIdDb}.\nflags=${fmtFlags(row?.flags)}`;
  }

  return "Usage: debug_region_pvp show|on|off|warfront <id>";
}
