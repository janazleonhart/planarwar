// worldcore/mud/commands/debug/debugThreatCommand.ts
//
// Debug: inspect NPC threat tables and taunt/assist state.
//
// Usage:
//   debug_threat                      (lists NPCs in room with top target)
//   debug_threat <npcHandle|entityId> (dumps threat table for one NPC)
//   debug_threat <...> --json         (JSON output)
//   debug_threat <...> --watch [ms]   (stream updates; use --watch off to stop)
//   debug_threat <...> --set <targetHandle|entityId> <value> [--add] [--clear] [--force <ms>]
//
// Notes:
// - Uses NearbyHandles numbering (e.g. rat.1) when possible.
// - Gated via withDebugGate() in the command registry.

import { getTopThreatTarget, type NpcThreatState } from "../../../npc/NpcThreat";
import { resolveNearbyHandleInRoom, getEntityXZ } from "../../handles/NearbyHandles";

type MudInput = { cmd: string; args: string[]; parts: string[] };

const DEFAULT_NEARBY_RADIUS = 30;
const DEFAULT_WATCH_MS = 500;

type WatchEntry = {
  timer: NodeJS.Timeout;
  roomId: string;
  npcEntityId?: string; // if omitted, watch all NPCs in the room
  intervalMs: number;

  // Per-watch de-dupe so we only print forced-clear breadcrumbs once.
  lastForcedClearedAtByNpc?: Record<string, number>;
};

// One watcher per session.
const WATCHERS = new Map<string, WatchEntry>();

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function parseFlag(args: string[], flag: string): boolean {
  const f = norm(flag);
  return (args ?? []).some((a) => norm(a) === f || norm(a) === `--${f.replace(/^--/, "")}`);
}

function valuesAfterFlag(args: string[], flag: string, count: number): string[] {
  const out: string[] = [];
  const f = norm(flag).replace(/^--/, "");
  const list = args ?? [];
  for (let i = 0; i < list.length; i++) {
    const a = norm(list[i]).replace(/^--/, "");
    if (a !== f) continue;
    for (let j = 1; j <= count; j++) {
      const v = String(list[i + j] ?? "").trim();
      if (!v || norm(v).startsWith("--")) break;
      out.push(v);
    }
    break;
  }
  while (out.length < count) out.push("");
  return out;
}

function getAfterFlag(args: string[], flag: string): string {
  const f = norm(flag).replace(/^--/, "");
  const a = args ?? [];
  for (let i = 0; i < a.length; i++) {
    const v = norm(a[i]).replace(/^--/, "");
    if (v !== f) continue;
    const next = a[i + 1];
    if (!next) return "";
    if (norm(next).startsWith("--")) return "";
    return String(next).trim();
  }
  return "";
}

function firstNonFlag(args: string[]): string {
  for (const a of args ?? []) {
    const v = norm(a);
    if (!v) continue;
    if (v.startsWith("--")) continue;
    if (v === "watch" || v === "set") continue;
    return String(a).trim();
  }
  return "";
}

function toNum(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function getRoomEntities(ctx: any, roomId: string): any[] {
  return (ctx?.entities as any)?.getEntitiesInRoom?.(roomId) ?? [];
}

function getSelfEntity(ctx: any): any | null {
  return (ctx?.entities as any)?.getEntityByOwner?.(ctx?.session?.id) ?? null;
}

function stopWatchForSession(ctx: any, sessionId: string): string {
  const w = WATCHERS.get(sessionId);
  if (!w) return "[debug][threat] Watch is already off.";
  clearInterval(w.timer);
  WATCHERS.delete(sessionId);
  return "[debug][threat] Watch stopped.";
}

function startWatchForSession(ctx: any, sessionId: string, roomId: string, npcEntityId: string | undefined, intervalMs: number): string {
  // Stop any existing watcher.
  const prev = WATCHERS.get(sessionId);
  if (prev) {
    clearInterval(prev.timer);
    WATCHERS.delete(sessionId);
  }

  const safeMs = Math.max(50, Math.min(5000, Math.floor(intervalMs)));

  const lastForcedClearedAtByNpc: Record<string, number> = {};

  const timer = setInterval(() => {
    try {
      const session = (ctx?.sessions as any)?.get?.(sessionId) ?? ctx?.session;
      if (!session) {
        // Session disappeared; stop.
        stopWatchForSession(ctx, sessionId);
        return;
      }

      const now = Date.now();
      const entities = getRoomEntities(ctx, roomId);
      const npcsInRoom = entities.filter(isNpcLike);

      // Helper: send a line.
      const send = (text: string) => {
        try {
          (ctx?.sessions as any)?.send?.(session, "mud_result", { text });
        } catch {
          /* ignore */
        }
      };

      if (!npcsInRoom.length) {
        send("[debug][threat][watch] No NPCs in room.");
        return;
      }

      if (npcEntityId) {
        const npc = npcsInRoom.find((n) => String(n.id) === String(npcEntityId));
        if (!npc) {
          send("[debug][threat][watch] NPC no longer present; stopping.");
          stopWatchForSession(ctx, sessionId);
          return;
        }
        const threat = (ctx.npcs as any).getThreatState?.(String(npc.id)) as NpcThreatState | undefined;
        const top = getTopThreatTarget(threat, now);
        const forcedRem =
          threat?.forcedTargetEntityId &&
          typeof threat.forcedUntil === "number" &&
          now < threat.forcedUntil
            ? Math.max(0, Math.floor(threat.forcedUntil - now))
            : 0;
        const forcedTxt = forcedRem > 0 ? ` forced=${String(threat!.forcedTargetEntityId).slice(0, 8)}(${forcedRem}ms)` : "";

        let clearedTxt = "";
        const clearedAt = typeof (threat as any)?.forcedClearedAt === "number" ? (threat as any).forcedClearedAt : 0;
        const lastSeen = lastForcedClearedAtByNpc[String(npc.id)] ?? 0;
        if (clearedAt > 0 && clearedAt !== lastSeen) {
          lastForcedClearedAtByNpc[String(npc.id)] = clearedAt;
          const why = String((threat as any)?.forcedClearedReason ?? "invalid");
          const who = String((threat as any)?.forcedClearedTargetEntityId ?? "").slice(0, 8);
          clearedTxt = ` cleared=${who || "?"}(${why})`;
        }

        send(`[debug][threat][watch] ${entityLabel(npc)} top=${top ? String(top).slice(0, 8) : "(none)"}${forcedTxt}${clearedTxt}`);
        return;
      }

      // All NPCs summary (top target only)
      const parts: string[] = [];
      for (const npc of npcsInRoom.slice(0, 10)) {
        const threat = (ctx.npcs as any).getThreatState?.(String(npc.id)) as NpcThreatState | undefined;
        const top = getTopThreatTarget(threat, now);
        const forcedActive =
          !!threat?.forcedTargetEntityId &&
          typeof threat?.forcedUntil === "number" &&
          now < (threat?.forcedUntil ?? 0);
        const clearedAt = typeof (threat as any)?.forcedClearedAt === "number" ? (threat as any).forcedClearedAt : 0;
        const lastSeen = lastForcedClearedAtByNpc[String(npc.id)] ?? 0;
        const hasNewCleared = clearedAt > 0 && clearedAt !== lastSeen;
        if (hasNewCleared) lastForcedClearedAtByNpc[String(npc.id)] = clearedAt;

        parts.push(`${String(npc.name ?? "NPC")}:${top ? String(top).slice(0, 8) : "-"}${forcedActive ? "!" : ""}${hasNewCleared ? "~" : ""}`);
      }
      send(`[debug][threat][watch] ${parts.join(" ")}`);
    } catch {
      // ignore
    }
  }, safeMs);

  WATCHERS.set(sessionId, { timer, roomId, npcEntityId, intervalMs: safeMs, lastForcedClearedAtByNpc });
  if (npcEntityId) return `[debug][threat] Watch started for ${String(npcEntityId).slice(0, 8)} every ${safeMs}ms.`;
  return `[debug][threat] Watch started for room NPCs every ${safeMs}ms.`;
}

function resolveEntityInRoom(ctx: any, char: any, roomId: string, raw: string): any | null {
  const handleRaw = String(raw ?? "").trim();
  if (!handleRaw) return null;

  // Prefer entity manager handle resolvers if present.
  const em = ctx?.entities as any;
  if (em) {
    for (const fnName of ["resolveInRoomByHandle", "resolveHandleInRoom"]) {
      if (typeof em[fnName] === "function") {
        try {
          const hit = em[fnName](roomId, handleRaw);
          if (hit) return hit;
        } catch {
          /* ignore */
        }
      }
    }
    if (typeof em.resolveHandle === "function") {
      try {
        const hit = em.resolveHandle(handleRaw);
        if (hit) return hit;
      } catch {
        /* ignore */
      }
    }
  }

  // Fallback: NearbyHandles reconstruction.
  const entities = getRoomEntities(ctx, roomId);
  const self = getSelfEntity(ctx);
  const selfId = self?.id ? String(self.id) : null;

  const sxz = getEntityXZ(self ?? {});
  const originX = toNum((char as any)?.posX) ?? toNum((char as any)?.x) ?? sxz.x ?? 0;
  const originZ = toNum((char as any)?.posZ) ?? toNum((char as any)?.z) ?? sxz.z ?? 0;

  const viewerSessionId = String(ctx?.session?.id ?? "");

  const hit = resolveNearbyHandleInRoom({
    entities,
    viewerSessionId,
    originX,
    originZ,
    radius: DEFAULT_NEARBY_RADIUS,
    excludeEntityId: selfId,
    limit: 200,
    handleRaw: handleRaw,
  });

  return hit?.entity ?? null;
}

function isNpcLike(e: any): boolean {
  const t = String(e?.type ?? "");
  return t === "npc" || t === "mob";
}

function entityLabel(e: any): string {
  const name = String(e?.name ?? e?.model ?? "NPC");
  const id = String(e?.id ?? "");
  return `${name} (${id.slice(0, 8) || id})`;
}

function formatThreatTable(threat: NpcThreatState | undefined, entitiesById: Map<string, any>, now: number): any {
  const forced =
    threat?.forcedTargetEntityId &&
    typeof threat.forcedUntil === "number" &&
    now < threat.forcedUntil
      ? { entityId: threat.forcedTargetEntityId, until: threat.forcedUntil }
      : null;

  const table = threat?.threatByEntityId ?? {};
  const rows = Object.entries(table)
    .map(([id, v]) => ({ entityId: id, threat: typeof v === "number" ? v : 0 }))
    .sort((a, b) => b.threat - a.threat)
    .slice(0, 50)
    .map((r) => {
      const ent = entitiesById.get(r.entityId);
      return {
        ...r,
        name: ent ? String(ent.name ?? ent.model ?? "") : "",
        type: ent ? String(ent.type ?? "") : "",
      };
    });

  return {
    lastAttackerEntityId: threat?.lastAttackerEntityId ?? null,
    lastAggroAt: threat?.lastAggroAt ?? null,
    forced,
    forcedClearedAt: (threat as any)?.forcedClearedAt ?? null,
    forcedClearedReason: (threat as any)?.forcedClearedReason ?? null,
    forcedClearedTargetEntityId: (threat as any)?.forcedClearedTargetEntityId ?? null,
    topTarget: getTopThreatTarget(threat, now) ?? null,
    rows,
  };
}

export function formatThreatReport(ctx: any, npcEntity: any, threat: NpcThreatState | undefined, now: number): string {
  const roomId = String(npcEntity?.roomId ?? ctx?.session?.roomId ?? "");
  const entities = roomId ? getRoomEntities(ctx, roomId) : [];
  const byId = new Map<string, any>();
  for (const e of entities) byId.set(String(e?.id ?? ""), e);

  const snap = formatThreatTable(threat, byId, now);
  const lines: string[] = [];
  lines.push(`[debug][threat] ${entityLabel(npcEntity)}`);
  if (snap.forced) {
    lines.push(`forced: ${String(snap.forced.entityId).slice(0, 8)} until=${snap.forced.until}`);
  } else {
    lines.push(`forced: (none)`);
  }
  if (snap.forcedClearedAt && snap.forcedClearedTargetEntityId) {
    lines.push(
      `forcedCleared: ${String(snap.forcedClearedTargetEntityId).slice(0, 8)} at=${snap.forcedClearedAt} why=${String(snap.forcedClearedReason ?? "invalid")}`,
    );
  }
  lines.push(`top: ${snap.topTarget ? String(snap.topTarget).slice(0, 8) : "(none)"}`);
  lines.push(`lastAttacker: ${snap.lastAttackerEntityId ? String(snap.lastAttackerEntityId).slice(0, 8) : "(none)"}`);
  if (!snap.rows.length) {
    lines.push(`table: (empty)`);
    return lines.join("\n");
  }
  lines.push(`table:`);
  for (const r of snap.rows) {
    const n = r.name ? ` ${r.name}` : "";
    const t = r.type ? ` [${r.type}]` : "";
    lines.push(` - ${String(r.entityId).slice(0, 8)} = ${r.threat}${n}${t}`);
  }
  return lines.join("\n");
}

export async function handleDebugThreat(ctx: any, char: any, input: MudInput): Promise<string> {
  const roomId = String(ctx?.session?.roomId ?? "");
  if (!roomId) return "[debug] You are not in a world room.";
  if (!ctx?.entities) return "[debug] Entity manager unavailable.";
  if (!ctx?.npcs) return "[debug] NPC manager unavailable.";

  const sessionId = String(ctx?.session?.id ?? "");
  if (!sessionId) return "[debug] Missing session.";

  const now = Date.now();
  const json = parseFlag(input?.args ?? [], "json");
  const watch = parseFlag(input?.args ?? [], "watch");
  const stop = parseFlag(input?.args ?? [], "stop") || (watch && norm(getAfterFlag(input?.args ?? [], "watch")) === "off");

  const setMode = parseFlag(input?.args ?? [], "set");
  const clearMode = parseFlag(input?.args ?? [], "clear");
  const addMode = parseFlag(input?.args ?? [], "add");
  const forceMsRaw = getAfterFlag(input?.args ?? [], "force");
  const forceMs = toNum(forceMsRaw);

  const token = firstNonFlag(input?.args ?? []);

  const entities = getRoomEntities(ctx, roomId);
  const npcsInRoom = entities.filter(isNpcLike);

  // Stop watch.
  if (stop) {
    return stopWatchForSession(ctx, sessionId);
  }

  // No arg: list NPCs with top target.
  if (!token) {
    if (watch) {
      const ms = toNum(getAfterFlag(input?.args ?? [], "watch")) ?? DEFAULT_WATCH_MS;
      return startWatchForSession(ctx, sessionId, roomId, undefined, ms);
    }
    if (!npcsInRoom.length) return "[debug][threat] No NPCs in this room.";
    const lines: string[] = ["[debug][threat] NPCs in room:"];
    for (const n of npcsInRoom.slice(0, 50)) {
      const threat = (ctx.npcs as any).getThreatState?.(String(n.id)) as NpcThreatState | undefined;
      const top = getTopThreatTarget(threat, now);
      lines.push(` - ${entityLabel(n)} top=${top ? String(top).slice(0, 8) : "(none)"}`);
    }
    return lines.join("\n");
  }

  // Resolve entity.
  const target = resolveEntityInRoom(ctx, char, roomId, token);
  const npcEntity = target && isNpcLike(target) ? target : null;

  if (!npcEntity) return `[debug][threat] Could not resolve NPC '${token}'.`;

  // --watch for a specific NPC
  if (watch) {
    const ms = toNum(getAfterFlag(input?.args ?? [], "watch")) ?? DEFAULT_WATCH_MS;
    return startWatchForSession(ctx, sessionId, roomId, String(npcEntity.id), ms);
  }

  // --set / --clear threat state (dev-only, gated at registry level)
  if (setMode || clearMode) {
    const setArgs = input?.args ?? [];

    // If --clear was provided without --set.
    if (clearMode && !setMode) {
      (ctx.npcs as any).debugClearThreat?.(String(npcEntity.id));
      return `[debug][threat] Cleared threat for ${entityLabel(npcEntity)}.`;
    }

    const [targetTok, valueTok] = valuesAfterFlag(setArgs, "set", 2);

    if (clearMode) {
      (ctx.npcs as any).debugClearThreat?.(String(npcEntity.id));
    }

    const targetEnt = resolveEntityInRoom(ctx, char, roomId, targetTok);
    if (!targetEnt) return `[debug][threat] Could not resolve target '${targetTok}'.`;

    const value = toNum(valueTok);
    if (value == null) return `[debug][threat] Invalid threat value '${valueTok}'.`;

    (ctx.npcs as any).debugSetThreatValue?.(String(npcEntity.id), String(targetEnt.id), value, {
      add: addMode,
      now,
    });

    if (typeof forceMs === "number" && forceMs > 0) {
      (ctx.npcs as any).debugForceTarget?.(String(npcEntity.id), String(targetEnt.id), Math.floor(forceMs), { now });
    }

    const verb = addMode ? "Added" : "Set";
    return `[debug][threat] ${verb} threat for ${entityLabel(npcEntity)}: ${String(targetEnt.id).slice(0, 8)} = ${value}${clearMode ? " (cleared first)" : ""}${typeof forceMs === "number" && forceMs > 0 ? ` force=${Math.floor(forceMs)}ms` : ""}.`;
  }

  const threat = (ctx.npcs as any).getThreatState?.(String(npcEntity.id)) as NpcThreatState | undefined;

  if (json) {
    const byId = new Map<string, any>();
    for (const e of entities) byId.set(String(e?.id ?? ""), e);
    const snap = formatThreatTable(threat, byId, now);
    return JSON.stringify({ npc: { id: npcEntity.id, name: npcEntity.name, roomId }, threat: snap }, null, 2);
  }

  return formatThreatReport(ctx, npcEntity, threat, now);
}
