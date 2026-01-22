// worldcore/mud/commands/world/nearbyCommand.ts
//
// Nearby listing with:
//
// - Corpse labeling:
//     * Dead NPCs are shown as [corpse] and suffixed with (corpse)
//     * If corpse has skinned=true, suffix becomes (skinned)
//
// - Filters:
//     * --alive  : hide all non-alive entities (primarily corpses)
//     * --dead   : show corpses only (dead NPCs)
//     * --type   : comma-separated type filter (npc,corpse,node,station,town,mailbox,rest,player)
//                aliases: mobs->npc, corpses/dead->corpse, nodes->node, stations->station
//
// - Controls:
//     * --range N   : override radius (default 30)
//     * --limit N   : override result count (default 20, hard cap 200)
//     * --sort dist|name|type
//     * --group     : group output by type (also implied by --sort type)
//
// Notes:
// - Preserves existing visibility rules for personal nodes:
//     * show nodes only if they have spawnPointId AND are shared or owned by you
//     * hide other players' personal nodes entirely
// - Preserves refresh behavior:
//     * refresh personal nodes (NpcSpawnController.spawnPersonalNodesFromRegion)
//     * optional spawn hydration (ctx.spawnHydrator.rehydrateRoom) gated by WORLD_SPAWNS_ENABLED
//
// Examples:
//   nearby
//   nearby --sort type
//   nearby --alive --sort dist
//   nearby --type npc,corpse --sort type
//   nearby --type node --range 12 --sort name --limit 50
//   nearby --group --sort dist --limit 60
import { isDeadNpcLike, makeShortHandleBase } from "../../handles/NearbyHandles";

type NearbyMode = "all" | "alive" | "dead";
type NearbySort = "dist" | "name" | "type";

const DEFAULT_RADIUS = 30;
const DEFAULT_LIMIT = 20;
const MAX_HARD_LIMIT = 200;

function normalizeArg(a: string): string {
  return String(a ?? "").trim().toLowerCase();
}

function parseIntOrNull(s: string): number | null {
  const n = Number.parseInt(String(s), 10);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function parseFlag(args: string[], flag: string): boolean {
  const f = normalizeArg(flag);
  return args.some((a) => normalizeArg(a) === f);
}

function parseKeyValue(args: string[], key: string): string | null {
  const k = normalizeArg(key);
  for (let i = 0; i < args.length; i++) {
    const a = normalizeArg(args[i]);

    if (a === k) {
      const v = args[i + 1] ?? "";
      return String(v);
    }

    if (a.startsWith(k + "=")) {
      return a.slice((k + "=").length);
    }
  }
  return null;
}

function parseMode(args: string[]): NearbyMode {
  if (parseFlag(args, "--dead") || parseFlag(args, "dead")) return "dead";
  if (parseFlag(args, "--alive") || parseFlag(args, "alive")) return "alive";
  return "all";
}

function parseSort(args: string[]): NearbySort {
  const raw = parseKeyValue(args, "--sort");
  const v = normalizeArg(raw ?? "");
  if (v === "name") return "name";
  if (v === "type" || v === "kind" || v === "group") return "type";
  if (v === "dist" || v === "distance") return "dist";
  return "dist";
}

function parseGroup(args: string[], sort: NearbySort): boolean {
  if (parseFlag(args, "--group") || parseFlag(args, "group")) return true;
  return sort === "type";
}

function parseRange(args: string[]): number | null {
  const raw = parseKeyValue(args, "--range") ?? parseKeyValue(args, "--radius");
  if (!raw) return null;
  const n = parseIntOrNull(raw);
  if (n === null || n <= 0) return null;
  return n;
}

function parseLimit(args: string[]): number | null {
  const raw = parseKeyValue(args, "--limit") ?? parseKeyValue(args, "--max");
  if (!raw) return null;
  const n = parseIntOrNull(raw);
  if (n === null || n <= 0) return null;
  return clamp(n, 1, MAX_HARD_LIMIT);
}

function parseTypeFilter(args: string[]): Set<string> | null {
  const raw = parseKeyValue(args, "--type") ?? parseKeyValue(args, "--types");
  if (!raw) return null;

  const set = new Set<string>();
  for (const token of String(raw).split(",")) {
    const t0 = normalizeArg(token);
    if (!t0) continue;

    const t =
      t0 === "mobs" || t0 === "mob" ? "npc"
      : t0 === "corpses" ? "corpse"
      : t0 === "dead" ? "corpse"
      : t0 === "nodes" ? "node"
      : t0 === "stations" ? "station"
      : t0;

    set.add(t);
  }

  return set.size > 0 ? set : null;
}

function isWorldSpawnsEnabled(): boolean {
  const v = String(process.env.WORLD_SPAWNS_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

type NearbyEntry = {
  e: any;
  dist: number;
  kindLabel: string; // what we display inside [ ... ]
  baseName: string;
  nameShown: string;
  deadNpc: boolean;
};

function kindGroupOrder(kindLabel: string): number {
  switch (kindLabel) {
    case "player": return 0;
    case "npc": return 1;
    case "corpse": return 2;
    case "node": return 3;
    case "station": return 4;
    case "mailbox": return 5;
    case "rest": return 6;
    case "town": return 7;
    default: return 99;
  }
}

function groupHeader(kindLabel: string): string {
  switch (kindLabel) {
    case "player": return "Players";
    case "npc": return "NPCs";
    case "corpse": return "Corpses";
    case "node": return "Nodes";
    case "station": return "Stations";
    case "mailbox": return "Mailboxes";
    case "rest": return "Rest spots";
    case "town": return "Towns";
    default: return "Other";
  }
}

export async function handleNearbyCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const roomId = ctx.session.roomId;
  if (!roomId) return "You are not in a world room.";

  const args = input?.args ?? [];

  const sort = parseSort(args);
  const mode = parseMode(args);
  const group = parseGroup(args, sort);

  const rangeOverride = parseRange(args);
  const radius = rangeOverride ?? DEFAULT_RADIUS;

  const limitOverride = parseLimit(args);
  const limit = limitOverride ?? DEFAULT_LIMIT;

  const typeFilter = parseTypeFilter(args);

  const originX = char.posX ?? 0;
  const originZ = char.posZ ?? 0;

  // --- Refresh on-demand before snapshotting entities ---
  try {
    const shardId = char.shardId ?? "prime_shard";
    const regionId = char.lastRegionId ?? char.regionId ?? roomId;

    if (ctx.npcSpawns?.spawnPersonalNodesFromRegion) {
      await ctx.npcSpawns.spawnPersonalNodesFromRegion(
        shardId,
        regionId,
        roomId,
        ctx.session.id,
        char
      );
    }

    if (isWorldSpawnsEnabled() && ctx.spawnHydrator?.rehydrateRoom) {
      await ctx.spawnHydrator.rehydrateRoom({ shardId, regionId, roomId });
    }
  } catch {
    // nearby should still work even if refresh fails
  }

  // IMPORTANT: query entities AFTER refresh, otherwise you print a stale snapshot.
  const entities = ctx.entities?.getEntitiesInRoom?.(roomId) ?? [];

  // Exclude self by entity id (NOT by ownerSessionId),
  // because personal nodes also have ownerSessionId.
  const self = ctx.entities?.getEntityByOwner?.(ctx.session.id);
  const selfId = self?.id;

  const others = entities.filter((e: any) => e && e.id && e.id !== selfId);
  if (others.length === 0) return "No nearby entities.";

  const entries: NearbyEntry[] = [];

  for (const e of others) {
    const dx = (e.x ?? 0) - originX;
    const dz = (e.z ?? 0) - originZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > radius) continue;

    const deadNpc = isDeadNpcLike(e);

    // Mode filters
    if (mode === "dead" && !deadNpc) continue;
    if (mode === "alive" && e?.alive === false) continue;

    const hasSpawnPoint = typeof e?.spawnPointId === "number";

    // If it has an ownerSessionId but NO spawnPointId, it's player-like.
    const isPlayerLike = !!e?.ownerSessionId && !hasSpawnPoint;

    // Real nodes must have spawnPointId and be shared or owned by you.
    const isRealNode =
      (e.type === "node" || e.type === "object") &&
      hasSpawnPoint &&
      (!e.ownerSessionId || e.ownerSessionId === ctx.session.id);

    // Hide foreign/invalid personal nodes entirely.
    if ((e.type === "node" || e.type === "object") && !isRealNode) continue;

    // Normalize type into display label
    let kindLabel: string;

    if (isPlayerLike) {
      kindLabel = "player";
    } else if (e.type === "npc" || e.type === "mob") {
      kindLabel = deadNpc ? "corpse" : "npc";
    } else if (isRealNode) {
      kindLabel = "node";
    } else {
      kindLabel = String(e.type ?? "entity");
    }

    // Type filter (post-normalization)
    if (typeFilter && !typeFilter.has(kindLabel)) continue;

    const baseName = String(e.name ?? e.id);
    const suffix =
      deadNpc && e?.skinned ? " (skinned)"
      : deadNpc ? " (corpse)"
      : "";

    const nameShown = `${baseName}${suffix}`;

    entries.push({ e, dist, kindLabel, baseName, nameShown, deadNpc });
  }

  if (entries.length === 0) return `No nearby entities (within ${radius}).`;

  // Sort + limit
  const sorted = entries.slice().sort((a, b) => {
    if (sort === "type") {
      const ga = kindGroupOrder(a.kindLabel);
      const gb = kindGroupOrder(b.kindLabel);
      if (ga !== gb) return ga - gb;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return a.baseName.toLowerCase().localeCompare(b.baseName.toLowerCase());
    }

    if (sort === "name") {
      const an = a.baseName.toLowerCase();
      const bn = b.baseName.toLowerCase();
      if (an !== bn) return an.localeCompare(bn);
      if (a.dist !== b.dist) return a.dist - b.dist;
      return String(a.e?.id ?? "").localeCompare(String(b.e?.id ?? ""));
    }

    // default dist
    if (a.dist !== b.dist) return a.dist - b.dist;

    // if same distance: alive first, then corpses
    if (a.deadNpc !== b.deadNpc) return a.deadNpc ? 1 : -1;

    const an = a.baseName.toLowerCase();
    const bn = b.baseName.toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return String(a.e?.id ?? "").localeCompare(String(b.e?.id ?? ""));
  }).slice(0, limit);

  // Build short targets like rat.2 / vein.1 for convenience.
  const shortCounts = new Map<string, number>();
  const buildHandle = (kindLabel: string, baseName: string): string => {
    const shortBase = makeShortHandleBase(baseName);
    const key = `${kindLabel}:${shortBase}`;
    const n = (shortCounts.get(key) ?? 0) + 1;
    shortCounts.set(key, n);
    return `${shortBase}.${n}`;
  };

  const lines: string[] = [];
  let index = 1;

  if (group) {
    const groups = new Map<string, NearbyEntry[]>();
    for (const it of sorted) {
      const arr = groups.get(it.kindLabel) ?? [];
      arr.push(it);
      groups.set(it.kindLabel, arr);
    }

    const keys = Array.from(groups.keys()).sort((a, b) => kindGroupOrder(a) - kindGroupOrder(b));
    for (const k of keys) {
      lines.push(`${groupHeader(k)}:`);
      const arr = groups.get(k)!;
      for (const it of arr) {
        const hint = buildHandle(it.kindLabel, it.baseName);
        lines.push(
          `  ${index}) [${it.kindLabel}] ${it.nameShown} (dist ${it.dist.toFixed(1)}) -> ${hint}`
        );
        index++;
      }
    }
  } else {
    for (const it of sorted) {
      const hint = buildHandle(it.kindLabel, it.baseName);
      lines.push(
        `${index}) [${it.kindLabel}] ${it.nameShown} (dist ${it.dist.toFixed(1)}) -> ${hint}`
      );
      index++;
    }
  }

  if (lines.length === 0) return `No nearby entities (within ${radius}).`;

  const modeTip =
    mode === "dead"
      ? "Showing corpses only."
      : mode === "alive"
        ? "Hiding corpses."
        : "Use 'nearby --alive' to hide corpses, or 'nearby --dead' to list corpses only.";

  const typeTip =
    typeFilter
      ? `Type filter: ${Array.from(typeFilter).join(", ")}.`
      : "Filter by type with: nearby --type npc,node,station,corpse.";

  const sortTip = `Sort: ${sort}${group ? " (grouped)" : ""}.`;
  const rangeTip = rangeOverride ? `Range: ${radius}.` : `Range: ${DEFAULT_RADIUS} (default).`;
  const limitTip = limitOverride ? `Limit: ${limit}.` : `Limit: ${DEFAULT_LIMIT} (default).`;

  lines.push(
    `Tip: target by number (e.g. 'talk 2') or by handle (e.g. 'talk rat.1'). ${modeTip} ${typeTip} ${sortTip} ${rangeTip} ${limitTip}`
  );

  return lines.join("\n");
}
