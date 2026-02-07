// worldcore/mud/commands/debug/debugEffectsCommand.ts
//
// Debug: inspect a target's active status effects + combat snapshot.
//
// Usage:
//   debug_effects                (self)
//   debug_effects <entityId>
//   debug_effects <nearbyHandle> (e.g. rat.1)
//   debug_effects <nearbyHandle> --json
//   debug_effects <nearbyHandle> --raw
//
// Notes:
// - Tries EntityManager handle resolvers first (if present).
// - Falls back to NearbyHandles resolveNearbyHandleInRoom (nearby-style handle numbering, range=30).
// - Also shows CharacterState status effects when target is a player (ownerSessionId -> session.character).

import * as StatusEffects from "../../../combat/StatusEffects";
import { getEntityXZ, resolveNearbyHandleInRoom } from "../../handles/NearbyHandles";

type MudInput = {
  cmd: string;
  args: string[];
  parts: string[];
};

type ResolveResult =
  | { ok: true; entity: any; resolvedBy: string; roomId: string }
  | { ok: false; error: string };

const DEFAULT_NEARBY_RADIUS = 30;

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function isFlag(a: string): boolean {
  const v = norm(a);
  return v.startsWith("--") || v === "json" || v === "raw";
}

function parseFlag(args: string[], flag: string): boolean {
  const f = norm(flag);
  return (args ?? []).some((a) => norm(a) === f);
}

function looksLikeNearbyHandle(raw: string): boolean {
  const s = String(raw ?? "").trim();
  return /^[a-z0-9_]+\.[0-9]+$/i.test(s);
}

function parseNearbyHandle(raw: string): { base: string; idx: number } | null {
  const s = norm(raw);
  if (!looksLikeNearbyHandle(s)) return null;
  const [base, idxRaw] = s.split(".", 2);
  const idx = Number.parseInt(idxRaw ?? "", 10);
  if (!base || !Number.isFinite(idx) || idx <= 0) return null;
  return { base, idx };
}

function makeShortHandleBase(name: string): string {
  const words = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return words[words.length - 1] ?? "entity";
}

function isDeadNpcLike(e: any): boolean {
  const t = String(e?.type ?? "");
  return (t === "npc" || t === "mob") && e?.alive === false;
}

function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function toNumber(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function getRoomEntities(ctx: any, roomId: string): any[] {
  return (ctx?.entities as any)?.getEntitiesInRoom?.(roomId) ?? [];
}

function getSelfEntity(ctx: any): any | null {
  return (ctx?.entities as any)?.getEntityByOwner?.(ctx?.session?.id) ?? null;
}

function resolveByDuckHandle(ctx: any, roomId: string, raw: string): any | null {
  const em = ctx?.entities as any;
  const handle = String(raw ?? "").trim();
  if (!em || !handle) return null;

  // Prefer in-room resolvers.
  if (typeof em.resolveInRoomByHandle === "function") {
    try {
      const hit = em.resolveInRoomByHandle(roomId, handle);
      if (hit) return hit;
    } catch {
      /* ignore */
    }
  }

  if (typeof em.resolveHandleInRoom === "function") {
    try {
      const hit = em.resolveHandleInRoom(roomId, handle);
      if (hit) return hit;
    } catch {
      /* ignore */
    }
  }

  // Generic resolver (may not be room-scoped).
  if (typeof em.resolveHandle === "function") {
    try {
      const hit = em.resolveHandle(handle);
      if (hit) return hit;
    } catch {
      /* ignore */
    }
  }

  return null;
}

function kindLabelForEntity(ctx: any, e: any): string {
  const hasSpawnPoint = typeof e?.spawnPointId === "number";

  // If it has an ownerSessionId but NO spawnPointId, it's player-like.
  const isPlayerLike = !!e?.ownerSessionId && !hasSpawnPoint;

  // Real nodes must have spawnPointId and be shared or owned by you.
  const isRealNode =
    (e?.type === "node" || e?.type === "object") &&
    hasSpawnPoint &&
    (!e?.ownerSessionId || e?.ownerSessionId === (ctx?.session as any)?.id);

  if (isPlayerLike) return "player";
  if (e?.type === "npc" || e?.type === "mob") return isDeadNpcLike(e) ? "corpse" : "npc";
  if (isRealNode) return "node";

  // A few common “world fixtures” are tagged in some rooms.
  const t = String(e?.type ?? "");
  if (t === "station") return "station";
  if (t === "mailbox") return "mailbox";
  if (t === "rest") return "rest";
  if (t === "town") return "town";

  return String(e?.type ?? "entity");
}

function resolveByNearbyReconstruction(
  ctx: any,
  char: any,
  roomId: string,
  raw: string,
): any | null {
  // System E: use the shared NearbyHandles resolver instead of re-implementing "nearby" sorting/numbering here.
  const handleRaw = String(raw ?? "").trim();
  if (!handleRaw) return null;

  const entities = getRoomEntities(ctx, roomId);
  if (!entities.length) return null;

  const self = getSelfEntity(ctx);
  const selfId = self?.id ? String(self.id) : null;

  // Prefer character coords if present (CharacterState uses posX/posZ); otherwise fall back to the self entity.
  const sxz = getEntityXZ(self ?? {});
  const originX = toNumber((char as any)?.posX) ?? toNumber((char as any)?.x) ?? sxz.x;
  const originZ = toNumber((char as any)?.posZ) ?? toNumber((char as any)?.z) ?? sxz.z;

  const viewerSessionId = String(ctx?.session?.id ?? "");

  const hit = resolveNearbyHandleInRoom({
    entities,
    viewerSessionId,
    originX: originX ?? 0,
    originZ: originZ ?? 0,
    radius: DEFAULT_NEARBY_RADIUS,
    excludeEntityId: selfId,
    limit: 200,
    handleRaw,
  });

  return hit?.entity ?? null;
}


function resolveTargetEntity(ctx: any, char: any, input: MudInput): ResolveResult {
  const roomId = ctx?.session?.roomId;
  if (!roomId) return { ok: false, error: "You are not in a world room." };

  const args = input?.args ?? [];
  const token = args.find((a) => !isFlag(a)) ?? "";

  // Default: self entity
  const tokenNorm = norm(token);

  if (!tokenNorm || tokenNorm === "self" || tokenNorm === "me") {
    const self = getSelfEntity(ctx);
    if (!self) return { ok: false, error: "No self entity found (are you in-world?)." };
    return { ok: true, entity: self, resolvedBy: "self", roomId };
  }

  // Entity id fast path
  const byId =
    (ctx?.entities as any)?.getEntityById?.(token) ??
    (ctx?.entities as any)?.getEntity?.(token) ??
    null;
  if (byId) return { ok: true, entity: byId, resolvedBy: "entityId", roomId };

  // Try entity manager handle resolvers (if any).
  const byDuck = resolveByDuckHandle(ctx, roomId, token);
  if (byDuck) return { ok: true, entity: byDuck, resolvedBy: "entityManager", roomId };

  // Fallback: reconstruct default nearby handles (rat.1, alchemist.1, etc).
  if (looksLikeNearbyHandle(token)) {
    const byNearby = resolveByNearbyReconstruction(ctx, char, roomId, token);
    if (byNearby) return { ok: true, entity: byNearby, resolvedBy: "nearbyHandle", roomId };
  }

  // Final fallback: match by exact name (rare, but handy).
  const all = getRoomEntities(ctx, roomId);
  const nameHit = all.find((e: any) => norm(e?.name) === norm(token));
  if (nameHit) return { ok: true, entity: nameHit, resolvedBy: "name", roomId };

  return {
    ok: false,
    error:
      "Could not resolve target. Use an entity id (e.g. npc.rat.1) or a nearby handle (e.g. rat.1).",
  };
}

function fmtStatusMeta(meta: any): string {
  if (!meta || typeof meta !== 'object') return '';
  const lastTick = typeof meta.lastTickAtMs === 'number' ? meta.lastTickAtMs : null;
  const lastPrune = typeof meta.lastPruneAtMs === 'number' ? meta.lastPruneAtMs : null;
  const lastPruned = typeof meta.lastPrunedCount === 'number' ? meta.lastPrunedCount : null;
  const totalPruned = typeof meta.totalPrunedCount === 'number' ? meta.totalPrunedCount : null;

  const bits: string[] = [];
  if (lastTick != null) bits.push(`lastTickAtMs=${lastTick}`);
  if (lastPrune != null) bits.push(`lastPruneAtMs=${lastPrune}`);
  if (lastPruned != null) bits.push(`lastPrunedCount=${lastPruned}`);
  if (totalPruned != null) bits.push(`totalPrunedCount=${totalPruned}`);

  return bits.length ? bits.join(' ') : '';
}

function fmtMsRemaining(expiresAtMs: number, now: number): string {
  if (!Number.isFinite(expiresAtMs)) return "?";
  const d = expiresAtMs - now;
  if (d <= 0) return "expired";
  if (d < 1000) return `${d}ms`;
  const s = d / 1000;
  if (s < 90) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 90) return `${m.toFixed(1)}m`;
  const h = m / 60;
  return `${h.toFixed(1)}h`;
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return "?";
  const pct = v * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function fmtSchoolMap(map: any | undefined): string {
  if (!map) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) continue;
    parts.push(`${k}:${fmtPct(n)}`);
  }
  return parts.length ? `{${parts.join(", ")}}` : "";
}

function fmtAttrMap(map: any | undefined): string {
  if (!map) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) continue;
    const sign = n > 0 ? "+" : "";
    parts.push(`${k}:${sign}${n}`);
  }
  return parts.length ? `{${parts.join(", ")}}` : "";
}

function summarizeModifiers(mods: any): string {
  const out: string[] = [];
  if (!mods) return "";

  const attrs = fmtAttrMap(mods.attributes ?? mods.attributesFlat);
  if (attrs) out.push(`attr${attrs}`);

  if (mods.attributesPct) {
    const p: string[] = [];
    for (const [k, v] of Object.entries(mods.attributesPct)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n === 0) continue;
      p.push(`${k}:${fmtPct(n)}`);
    }
    if (p.length) out.push(`attrPct{${p.join(", ")}}`);
  }

  if (typeof mods.damageDealtPct === "number" && mods.damageDealtPct !== 0) {
    out.push(`dmgDealt:${fmtPct(mods.damageDealtPct)}`);
  }
  if (typeof mods.damageTakenPct === "number" && mods.damageTakenPct !== 0) {
    out.push(`dmgTaken:${fmtPct(mods.damageTakenPct)}`);
  }

  const dealtBySchool = fmtSchoolMap(mods.damageDealtPctBySchool);
  if (dealtBySchool) out.push(`dmgDealtBySchool${dealtBySchool}`);

  const takenBySchool = fmtSchoolMap(mods.damageTakenPctBySchool);
  if (takenBySchool) out.push(`dmgTakenBySchool${takenBySchool}`);

  if (typeof mods.armorFlat === "number" && mods.armorFlat !== 0) {
    const sign = mods.armorFlat > 0 ? "+" : "";
    out.push(`armor:${sign}${mods.armorFlat}`);
  }
  if (typeof mods.armorPct === "number" && mods.armorPct !== 0) {
    out.push(`armorPct:${fmtPct(mods.armorPct)}`);
  }

  const resistFlat = mods.resistFlat ? fmtAttrMap(mods.resistFlat) : "";
  if (resistFlat) out.push(`resist${resistFlat}`);

  if (mods.resistPct) {
    const rp: string[] = [];
    for (const [k, v] of Object.entries(mods.resistPct)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n === 0) continue;
      rp.push(`${k}:${fmtPct(n)}`);
    }
    if (rp.length) out.push(`resistPct{${rp.join(", ")}}`);
  }

  return out.length ? out.join(" ") : "";
}

function safeComputeSnapshotForEntity(entity: any, now: number): any | null {
  const fn =
    (StatusEffects as any).computeEntityCombatStatusSnapshot ??
    (StatusEffects as any).computeCombatStatusSnapshotForEntity ??
    (StatusEffects as any).computeCombatStatusSnapshotForEntity;

  if (typeof fn !== "function") return null;

  try {
    return fn(entity, now);
  } catch {
    return null;
  }
}

function safeComputeSnapshotForChar(char: any, now: number): any | null {
  const fn =
    (StatusEffects as any).computeCombatStatusSnapshot ??
    (StatusEffects as any).computeCombatStatusSnapshotForChar ??
    (StatusEffects as any).computeCombatStatusSnapshotForCharacter;

  if (typeof fn !== "function") return null;

  try {
    return fn(char, now);
  } catch {
    return null;
  }
}

function safeGetActiveEffectsForEntity(entity: any, now: number): any[] {
  const fn =
    (StatusEffects as any).getActiveStatusEffectsForEntity ??
    (StatusEffects as any).getActiveStatusEffectsForNpc ??
    null;
  if (typeof fn !== "function") return [];
  try {
    return fn(entity, now) ?? [];
  } catch {
    return [];
  }
}

function safeGetActiveEffectsForChar(char: any, now: number): any[] {
  const fn = (StatusEffects as any).getActiveStatusEffects ?? null;
  if (typeof fn !== "function") return [];
  try {
    return fn(char, now) ?? [];
  } catch {
    return [];
  }
}

function resolveCharacterStateForEntity(ctx: any, entity: any, fallbackChar: any): any | null {
  // If target is self, we already have the CharacterState passed in.
  if (entity?.ownerSessionId && entity.ownerSessionId === ctx?.session?.id) return fallbackChar ?? null;

  const ownerSessionId = entity?.ownerSessionId;
  if (!ownerSessionId) return null;

  // Typical shape: ctx.sessions.get(sessionId) -> session.character
  try {
    const s =
      (ctx?.sessions as any)?.get?.(ownerSessionId) ??
      (ctx?.sessions as any)?.sessions?.get?.(ownerSessionId) ??
      null;

    return (s as any)?.character ?? (s as any)?.char ?? null;
  } catch {
    return null;
  }
}

export async function handleDebugEffects(ctx: any, char: any, input: MudInput): Promise<string> {
  const now = Date.now();

  const json = parseFlag(input?.args ?? [], "--json") || parseFlag(input?.args ?? [], "json");
  const raw = parseFlag(input?.args ?? [], "--raw") || parseFlag(input?.args ?? [], "raw");

  const resolved = resolveTargetEntity(ctx, char, input);
  if (!resolved.ok) return `[debug] ${resolved.error}`;

  const ent = resolved.entity;
  const entityEffects = safeGetActiveEffectsForEntity(ent, now);
  const entitySnapshot = safeComputeSnapshotForEntity(ent, now);

  const targetChar = resolveCharacterStateForEntity(ctx, ent, char);
  const charEffects = targetChar ? safeGetActiveEffectsForChar(targetChar, now) : [];
  const charSnapshot = targetChar ? safeComputeSnapshotForChar(targetChar, now) : null;

  if (json) {
    const payload: any = {
      target: {
        id: ent?.id,
        name: ent?.name,
        type: ent?.type,
        roomId: resolved.roomId,
        ownerSessionId: ent?.ownerSessionId,
        alive: ent?.alive,
        hp: ent?.hp,
        maxHp: ent?.maxHp,
        x: ent?.x,
        z: ent?.z,
        resolvedBy: resolved.resolvedBy,
      },
      effects: {
        entity: entityEffects,
        character: charEffects,
      },
      snapshot: {
        entity: entitySnapshot,
        character: charSnapshot,
      },
    };

    if (raw) {
      payload.raw = {
        entityCombatStatusEffects: ent?.combatStatusEffects ?? null,
        characterStatusEffects: (targetChar as any)?.progression?.statusEffects ?? null,
      };
    }

    return JSON.stringify(payload, null, 2);
  }

  const lines: string[] = [];

  lines.push(
    `[debug_effects] Target: ${String(ent?.name ?? ent?.id ?? "entity")} (id=${
      ent?.id ?? "?"
    }, type=${String(ent?.type ?? "?")}, alive=${String(ent?.alive ?? "?")}, room=${
      resolved.roomId
    }, resolvedBy=${resolved.resolvedBy})`,
  );

  if (typeof ent?.hp === "number" || typeof ent?.maxHp === "number") {
    const hp = typeof ent?.hp === "number" ? ent.hp : "?";
    const maxHp = typeof ent?.maxHp === "number" ? ent.maxHp : "?";
    lines.push(`[debug_effects] HP: ${hp}/${maxHp}`);
  }

  lines.push(`[debug_effects] Entity effects: ${entityEffects.length}`);
  const entMeta = (ent as any)?.combatStatusEffects?.meta;
  const entMetaLine = fmtStatusMeta(entMeta);
  if (entMetaLine) lines.push(`[debug_effects] Entity meta: ${entMetaLine}`);
  if (entityEffects.length === 0) {
    lines.push("  (none)");
  } else {
    for (const eff of entityEffects) {
      const id = String((eff as any)?.id ?? "?");
      const source = `${String((eff as any)?.sourceKind ?? "?")}:${String((eff as any)?.sourceId ?? "?")}`;
      const stacks = `${String((eff as any)?.stackCount ?? 1)}/${String((eff as any)?.maxStacks ?? 1)}`;
      const remain = fmtMsRemaining(Number((eff as any)?.expiresAtMs ?? 0), now);
      const mods = summarizeModifiers((eff as any)?.modifiers);
      const dot = (eff as any)?.dot
        ? `dot{intervalMs=${(eff as any).dot.tickIntervalMs}, perTick=${(eff as any).dot.perTickDamage}, nextAt=${fmtMsRemaining(Number((eff as any).dot.nextTickAtMs ?? 0), now)}}`
        : "";

      const extra = [];
      if (mods) extra.push(mods);
      if (dot) extra.push(dot);

      lines.push(`  - ${id} stacks=${stacks} remain=${remain} src=${source}${extra.length ? " " + extra.join(" ") : ""}`);
    }
  }

  if (targetChar) {
    lines.push(`[debug_effects] Character effects: ${charEffects.length}`);
    const charMeta = (targetChar as any)?.progression?.statusEffects?.meta;
    const charMetaLine = fmtStatusMeta(charMeta);
    if (charMetaLine) lines.push(`[debug_effects] Character meta: ${charMetaLine}`);
    if (charEffects.length === 0) {
      lines.push("  (none)");
    } else {
      for (const eff of charEffects) {
        const id = String((eff as any)?.id ?? "?");
        const source = `${String((eff as any)?.sourceKind ?? "?")}:${String((eff as any)?.sourceId ?? "?")}`;
        const stacks = `${String((eff as any)?.stackCount ?? 1)}/${String((eff as any)?.maxStacks ?? 1)}`;
        const remain = fmtMsRemaining(Number((eff as any)?.expiresAtMs ?? 0), now);
        const mods = summarizeModifiers((eff as any)?.modifiers);
        const dot = (eff as any)?.dot
          ? `dot{intervalMs=${(eff as any).dot.tickIntervalMs}, perTick=${(eff as any).dot.perTickDamage}, nextAt=${fmtMsRemaining(Number((eff as any).dot.nextTickAtMs ?? 0), now)}}`
          : "";

        const extra = [];
        if (mods) extra.push(mods);
        if (dot) extra.push(dot);

        lines.push(`  - ${id} stacks=${stacks} remain=${remain} src=${source}${extra.length ? " " + extra.join(" ") : ""}`);
      }
    }
  }

  if (entitySnapshot) {
    lines.push("[debug_effects] Entity snapshot:");
    lines.push(`  damageDealtPct=${fmtPct(Number(entitySnapshot.damageDealtPct ?? 0))} damageTakenPct=${fmtPct(Number(entitySnapshot.damageTakenPct ?? 0))}`);
    const dealtBySchool = fmtSchoolMap(entitySnapshot.damageDealtPctBySchool);
    const takenBySchool = fmtSchoolMap(entitySnapshot.damageTakenPctBySchool);
    if (dealtBySchool) lines.push(`  damageDealtPctBySchool=${dealtBySchool}`);
    if (takenBySchool) lines.push(`  damageTakenPctBySchool=${takenBySchool}`);

    const attrsFlat = fmtAttrMap(entitySnapshot.attributesFlat);
    const attrsPct = entitySnapshot.attributesPct
      ? `{${Object.entries(entitySnapshot.attributesPct)
          .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) !== 0)
          .map(([k, v]) => `${k}:${fmtPct(Number(v))}`)
          .join(", ")}}`
      : "";
    if (attrsFlat) lines.push(`  attributesFlat=${attrsFlat}`);
    if (attrsPct && attrsPct !== "{}") lines.push(`  attributesPct=${attrsPct}`);

    if (typeof entitySnapshot.armorFlat === "number" || typeof entitySnapshot.armorPct === "number") {
      const af = Number(entitySnapshot.armorFlat ?? 0);
      const ap = Number(entitySnapshot.armorPct ?? 0);
      lines.push(`  armorFlat=${af} armorPct=${fmtPct(ap)}`);
    }

    const rf = fmtAttrMap(entitySnapshot.resistFlat);
    if (rf) lines.push(`  resistFlat=${rf}`);

    if (entitySnapshot.resistPct) {
      const rp = `{${Object.entries(entitySnapshot.resistPct)
        .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) !== 0)
        .map(([k, v]) => `${k}:${fmtPct(Number(v))}`)
        .join(", ")}}`;
      if (rp !== "{}") lines.push(`  resistPct=${rp}`);
    }
  }

  if (charSnapshot) {
    lines.push("[debug_effects] Character snapshot:");
    lines.push(`  damageDealtPct=${fmtPct(Number(charSnapshot.damageDealtPct ?? 0))} damageTakenPct=${fmtPct(Number(charSnapshot.damageTakenPct ?? 0))}`);
    const dealtBySchool = fmtSchoolMap(charSnapshot.damageDealtPctBySchool);
    const takenBySchool = fmtSchoolMap(charSnapshot.damageTakenPctBySchool);
    if (dealtBySchool) lines.push(`  damageDealtPctBySchool=${dealtBySchool}`);
    if (takenBySchool) lines.push(`  damageTakenPctBySchool=${takenBySchool}`);
  }

  if (raw) {
    lines.push("[debug_effects] Raw:");
    lines.push(`  entity.combatStatusEffects=${JSON.stringify(ent?.combatStatusEffects ?? null)}`);
    if (targetChar) {
      lines.push(
        `  char.progression.statusEffects=${JSON.stringify((targetChar as any)?.progression?.statusEffects ?? null)}`,
      );
    }
  }

  return lines.join("\n");
}
