// worldcore/mud/commands/debug/debugThreatCommand.ts
//
// Debug: inspect NPC threat tables and taunt/assist state.
//
// Usage:
//   debug_threat                      (lists NPCs in room with top target)
//   debug_threat <npcHandle|entityId> (dumps threat table for one NPC)
//   debug_threat <...> --json         (JSON output)
//
// Notes:
// - Uses NearbyHandles numbering (e.g. rat.1) when possible.
// - Gated via withDebugGate() in the command registry.

import { getTopThreatTarget, type NpcThreatState } from "../../../npc/NpcThreat";
import { resolveNearbyHandleInRoom, getEntityXZ } from "../../handles/NearbyHandles";

type MudInput = { cmd: string; args: string[]; parts: string[] };

const DEFAULT_NEARBY_RADIUS = 30;

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function parseFlag(args: string[], flag: string): boolean {
  const f = norm(flag);
  return (args ?? []).some((a) => norm(a) === f || norm(a) === `--${f.replace(/^--/, "")}`);
}

function firstNonFlag(args: string[]): string {
  for (const a of args ?? []) {
    const v = norm(a);
    if (!v) continue;
    if (v.startsWith("--")) continue;
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

  const now = Date.now();
  const json = parseFlag(input?.args ?? [], "json");
  const token = firstNonFlag(input?.args ?? []);

  const entities = getRoomEntities(ctx, roomId);
  const npcsInRoom = entities.filter(isNpcLike);

  // No arg: list NPCs with top target.
  if (!token) {
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

  const threat = (ctx.npcs as any).getThreatState?.(String(npcEntity.id)) as NpcThreatState | undefined;

  if (json) {
    const byId = new Map<string, any>();
    for (const e of entities) byId.set(String(e?.id ?? ""), e);
    const snap = formatThreatTable(threat, byId, now);
    return JSON.stringify({ npc: { id: npcEntity.id, name: npcEntity.name, roomId }, threat: snap }, null, 2);
  }

  return formatThreatReport(ctx, npcEntity, threat, now);
}
