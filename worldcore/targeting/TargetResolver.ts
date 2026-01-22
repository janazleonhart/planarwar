// worldcore/targeting/TargetResolver.ts
//
// Universal in-room target resolver used by MUD commands.
//
// Goals:
// - Make numeric selectors + nearby handles consistent with `nearby` output (distance + visibility ordering).
// - Support entity id targeting (exact id match).
// - Keep a sane fallback for fuzzy name targeting when the user types plain text.
//
// Notes:
// - This module intentionally reuses mud/handles/NearbyHandles so that handle rules stay single-sourced.
// - The resolver is *side-effect free* and never mutates entities.
//

import type { Entity } from "../shared/Entity";

import {
  buildNearbyTargetSnapshot,
  parseHandleToken,
  resolveNearbyHandleInRoom,
  makeShortHandleBase,
} from "../mud/handles/NearbyHandles";

/**
 * We accept multiple "entity container" shapes because tests and subsystems
 * use different light stubs:
 * - EntityManager: getEntitiesInRoom(roomId) + getAll()
 * - Test stubs: getAll() only
 * - Rare callers: raw Entity[]
 */
export type EntityProvider = {
  getEntitiesInRoom?: (roomId: string) => Entity[];
  getAll?: () => Iterable<Entity> | Entity[];
};

export type ResolveTargetOpts = {
  /** Entity id of the actor (used to exclude self + derive origin/session when possible). */
  selfId?: string;

  /** Optional filter applied to candidate entities. */
  filter?: (e: Entity) => boolean;

  /**
   * Viewer session id used for visibility rules (personal nodes, etc).
   * If omitted, we attempt to derive it from the self entity's ownerSessionId.
   */
  viewerSessionId?: string;

  /**
   * Origin used for distance ordering (nearby-style). If omitted, we attempt to use self entity x/z.
   */
  originX?: number;
  originZ?: number;

  /** Nearby-style radius used when resolving numeric indexes/handles. Default: 30. */
  radius?: number;
};

function toArray<T>(v: Iterable<T> | T[] | null | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : Array.from(v);
}

function getEntitiesInRoomSafe(entities: EntityProvider | Entity[] | any, roomId: string): Entity[] {
  const rid = String(roomId ?? "");
  if (!rid) return [];

  // 1) Preferred: explicit in-room accessor
  try {
    const fn = (entities as any)?.getEntitiesInRoom;
    if (typeof fn === "function") {
      const out = fn.call(entities, rid);
      return Array.isArray(out) ? out : [];
    }
  } catch {
    // ignore and fall back
  }

  // 2) Common fallback: getAll() + roomId filter
  try {
    const fn = (entities as any)?.getAll;
    if (typeof fn === "function") {
      const all = toArray<Entity>(fn.call(entities));
      return all.filter((e: any) => String(e?.roomId ?? "") === rid);
    }
  } catch {
    // ignore
  }

  // 3) Raw arrays
  if (Array.isArray(entities)) {
    return (entities as any[]).filter((e: any) => String(e?.roomId ?? "") === rid) as any;
  }

  // 4) Very defensive: { entities: Map<string, Entity> }
  const maybeMap = (entities as any)?.entities;
  if (maybeMap && typeof maybeMap?.values === "function") {
    try {
      const all = Array.from(maybeMap.values()) as Entity[];
      return all.filter((e: any) => String(e?.roomId ?? "") === rid);
    } catch {
      // ignore
    }
  }

  return [];
}

function normName(s: any): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_\s.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coerceHandleToken(raw: string): string {
  // Support legacy "rat#2" style as a synonym for "rat.2"
  return raw.includes("#") ? raw.replace(/#/g, ".") : raw;
}

function isNumericToken(raw: string): boolean {
  return /^\d+$/.test(raw);
}

function looksLikeHandleToken(raw: string): boolean {
  return /^[a-z0-9_]+[.]\d+$/i.test(raw) || /^[a-z0-9_]+[#]\d+$/i.test(raw);
}

function findSelfEntity(entities: Entity[], selfId?: string): Entity | null {
  if (!selfId) return null;
  for (const e of entities) {
    if (String((e as any)?.id ?? "") === String(selfId)) return e;
  }
  return null;
}

function deriveViewerSessionId(self: Entity | null, opts: ResolveTargetOpts): string {
  const explicit = String(opts.viewerSessionId ?? "").trim();
  if (explicit) return explicit;
  const derived = String((self as any)?.ownerSessionId ?? "").trim();
  return derived;
}

function deriveOrigin(
  self: Entity | null,
  opts: ResolveTargetOpts
): { originX: number; originZ: number } {
  const ox = Number.isFinite(opts.originX as any)
    ? Number(opts.originX)
    : Number.isFinite((self as any)?.x)
      ? Number((self as any).x)
      : 0;
  const oz = Number.isFinite(opts.originZ as any)
    ? Number(opts.originZ)
    : Number.isFinite((self as any)?.z)
      ? Number((self as any).z)
      : 0;
  return { originX: ox, originZ: oz };
}

function buildSnapshot(
  candidates: Entity[],
  self: Entity | null,
  opts: ResolveTargetOpts
): ReturnType<typeof buildNearbyTargetSnapshot> {
  const { originX, originZ } = deriveOrigin(self, opts);
  const viewerSessionId = deriveViewerSessionId(self, opts);
  const radius = Math.max(0.5, Number.isFinite(opts.radius as any) ? Number(opts.radius) : 30);

  return buildNearbyTargetSnapshot({
    entities: candidates,
    viewerSessionId,
    originX,
    originZ,
    radius,
    excludeEntityId: opts.selfId ? String(opts.selfId) : undefined,
    limit: 200,
  });
}

function passFilter(e: Entity, opts: ResolveTargetOpts): boolean {
  return typeof opts.filter === "function" ? !!opts.filter(e) : true;
}

/**
 * Resolve a target inside a room using:
 * 1) exact entity id match
 * 2) nearby-style numeric index ("2" == 2nd row in `nearby` ordering)
 * 3) nearby handle ("rat.1" / "rat#1")
 * 4) nearby handle base ("rat" picks first matching base in nearby ordering)
 * 5) fuzzy name match (nearby ordering first, then stable name ordering)
 */
export function resolveTargetInRoom(
  entities: EntityProvider | Entity[] | any,
  roomId: string,
  targetRaw: string,
  opts: ResolveTargetOpts = {}
): Entity | null {
  const raw0 = String(targetRaw ?? "").trim();
  if (!raw0) return null;

  const inRoom = getEntitiesInRoomSafe(entities, roomId);
  if (!inRoom.length) return null;

  const self = findSelfEntity(inRoom, opts.selfId);

  // Candidate set (exclude self + apply filter)
  const candidates = inRoom.filter((e) => {
    if (opts.selfId && String((e as any)?.id ?? "") === String(opts.selfId)) return false;
    return passFilter(e, opts);
  });

  if (!candidates.length) return null;

  const raw = coerceHandleToken(raw0);
  const lowered = raw.toLowerCase();

  // 1) Exact id match (case sensitive first, then case-insensitive)
  for (const e of candidates) {
    const id = String((e as any)?.id ?? "");
    if (id === raw) return e;
  }
  for (const e of candidates) {
    const id = String((e as any)?.id ?? "");
    if (id.toLowerCase() === lowered) return e;
  }

  // Snapshot only when needed (it's a bit heavier than name scans).
  const needSnapshot = isNumericToken(raw) || looksLikeHandleToken(raw) || !!parseHandleToken(raw);
  const snapshot = needSnapshot ? buildSnapshot(candidates, self, opts) : [];

  // 2) Numeric selector: `nearby` index (1-based)
  if (isNumericToken(raw) && snapshot.length > 0) {
    const idx = Number(raw);
    if (Number.isInteger(idx) && idx > 0) {
      const pick = snapshot[idx - 1];
      if (pick?.e) return pick.e as any;
    }
    return null;
  }

  // 3) Nearby handle token: rat.1 / rat#1
  if (looksLikeHandleToken(raw)) {
    const hit = resolveNearbyHandleInRoom({
      entities: candidates,
      viewerSessionId: deriveViewerSessionId(self, opts),
      ...deriveOrigin(self, opts),
      radius: Math.max(0.5, Number.isFinite(opts.radius as any) ? Number(opts.radius) : 30),
      handleRaw: raw,
    });
    if (hit?.entity) return hit.entity as any;
    return null;
  }

  // 4) Handle base token: "rat" => first matching base in nearby ordering.
  // Also supports "rat." accidental trailing dot by parsing.
  const parsed = parseHandleToken(raw.endsWith(".") ? raw.slice(0, -1) : raw);
  if (parsed && !parsed.idx) {
    const base = parsed.base;
    if (snapshot.length > 0) {
      const pick = snapshot.find((x) => makeShortHandleBase(x.baseName) === base);
      if (pick?.e) return pick.e as any;
    }
    // If snapshot empty (e.g. no coords), fall through to fuzzy.
  } else if (parsed && parsed.idx) {
    // A handle-like token with idx but without explicit dot regex (defensive).
    const handle = `${parsed.base}.${parsed.idx}`;
    const hit = resolveNearbyHandleInRoom({
      entities: candidates,
      viewerSessionId: deriveViewerSessionId(self, opts),
      ...deriveOrigin(self, opts),
      radius: Math.max(0.5, Number.isFinite(opts.radius as any) ? Number(opts.radius) : 30),
      handleRaw: handle,
    });
    if (hit?.entity) return hit.entity as any;
    return null;
  }

  // 5) Fuzzy name match:
  // Prefer nearby ordering when we have it, otherwise stable by name.
  const needle = normName(raw);
  if (!needle) return null;

  if (snapshot.length > 0) {
    // Exact base match: "rat" hits entities whose short handle base is exactly "rat".
    const exactBase = snapshot.find((x) => makeShortHandleBase(x.baseName) === needle);
    if (exactBase?.e) return exactBase.e as any;

    // Name includes match in nearby ordering.
    const inc = snapshot.find((x) => normName(x.baseName).includes(needle));
    if (inc?.e) return inc.e as any;
  }

  // Fallback: stable match by normalized name.
  const stable = [...candidates].sort((a: any, b: any) => {
    const an = normName(a?.name ?? a?.id);
    const bn = normName(b?.name ?? b?.id);
    if (an < bn) return -1;
    if (an > bn) return 1;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });

  const stableHit =
    stable.find((e: any) => normName(e?.name ?? "").includes(needle)) ||
    stable.find((e: any) => normName(e?.id ?? "").includes(needle));

  return (stableHit as any) ?? null;
}
