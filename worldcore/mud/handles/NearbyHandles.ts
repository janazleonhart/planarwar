// worldcore/mud/handles/NearbyHandles.ts
//
// Shared helpers for "nearby-style" short handles like:
//
//   alchemist.1
//   guard.2
//   rat.1
//
// The goal is consistency: commands that accept nearby handles should agree on:
// - how entities are visible (esp. personal nodes),
// - how handles are generated,
// - and how collisions resolve (first match in nearby ordering wins).

export type NearbySnapshotEntry = {
  e: any;
  dist: number;
  kindLabel: string;
  baseName: string;
  handle: string;
};

export type HandleResolved = {
  entity: any;
  dist: number;
  handle: string;
};

function toNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


// Gate optional world spawn hydration (used by `nearby` refresh, etc).
// Default is enabled unless explicitly disabled.
export function isWorldSpawnsEnabled(): boolean {
  const raw = String(process.env.WORLD_SPAWNS_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

// Prefer live entity coords when available; fall back to character state.
export function getPlayerXZ(ctx: any, char: any): { x: number; z: number } {
  const sessionId = String(ctx?.session?.id ?? "");
  const ent =
    (sessionId && typeof ctx?.entities?.getEntityByOwner === "function"
      ? ctx.entities.getEntityByOwner(sessionId)
      : null) ?? null;

  const x =
    toNumber(ent?.x) ??
    toNumber(ent?.pos?.x) ??
    toNumber(ent?.position?.x) ??
    toNumber(ent?.coords?.x) ??
    toNumber(char?.x) ??
    toNumber(char?.pos?.x) ??
    toNumber(char?.position?.x) ??
    toNumber(char?.coords?.x) ??
    0;

  const z =
    toNumber(ent?.z) ??
    toNumber(ent?.pos?.z) ??
    toNumber(ent?.position?.z) ??
    toNumber(ent?.coords?.z) ??
    toNumber(char?.z) ??
    toNumber(char?.pos?.z) ??
    toNumber(char?.position?.z) ??
    toNumber(char?.coords?.z) ??
    0;

  return { x, z };
}

export function getEntityXZ(e: any): { x: number; z: number } {
  const x =
    toNumber(e?.x) ??
    toNumber(e?.pos?.x) ??
    toNumber(e?.position?.x) ??
    toNumber(e?.coords?.x) ??
    0;

  const z =
    toNumber(e?.z) ??
    toNumber(e?.pos?.z) ??
    toNumber(e?.position?.z) ??
    toNumber(e?.coords?.z) ??
    0;

  return { x, z };
}

export function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function isDeadNpcLike(e: any): boolean {
  const t = String(e?.type ?? "");
  return (t === "npc" || t === "mob") && e?.alive === false;
}

export function makeShortHandleBase(name: string): string {
  const words = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  return words[words.length - 1] ?? "entity";
}

export function makeShortHandleBaseFromEntity(e: any): string {
  const rawName = String(e?.name ?? "").trim();
  if (rawName) {
    const fromName = makeShortHandleBase(rawName);
    // makeShortHandleBase defaults to "entity" when it can't derive a token.
    if (fromName && fromName !== "entity") return fromName;
  }

  const protoId = String(e?.protoId ?? "").trim().toLowerCase();
  if (protoId) {
    const tail = protoId.split(/[._]/g).filter(Boolean).pop();
    if (tail) return tail.toLowerCase();
  }

  const t = String(e?.type ?? "").trim().toLowerCase();
  return t || "entity";
}


// Accept "rat", "rat.2", "guard_thing.10"
export function parseHandleToken(token: string): { base: string; idx?: number } | null {
  const t = String(token ?? "").trim().toLowerCase();
  if (!t) return null;
  const m = /^([a-z0-9_]+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;

  const base = m[1] ?? "";
  const idxStr = m[2];
  if (!base) return null;

  if (idxStr) {
    const idx = Number(idxStr);
    if (!Number.isFinite(idx) || idx <= 0) return null;
    return { base, idx };
  }

  return { base };
}

function classifyNearbyEntity(
  e: any,
  viewerSessionId: string
): { kindLabel: string; baseName: string; deadNpc: boolean } | null {
  const deadNpc = isDeadNpcLike(e);
  const hasSpawnPoint = typeof e?.spawnPointId === "number";

  // If it has an ownerSessionId but NO spawnPointId, it's player-like.
  const isPlayerLike = !!e?.ownerSessionId && !hasSpawnPoint;

  // Real nodes must have spawnPointId and be shared or owned by you.
  const isRealNode =
    (e?.type === "node" || e?.type === "object") &&
    hasSpawnPoint &&
    (!e?.ownerSessionId || String(e.ownerSessionId) === viewerSessionId);

  // Hide foreign/invalid personal nodes entirely.
  if ((e?.type === "node" || e?.type === "object") && !isRealNode) return null;

  let kindLabel: string;

  if (isPlayerLike) {
    kindLabel = "player";
  } else if (e?.type === "npc" || e?.type === "mob") {
    kindLabel = deadNpc ? "corpse" : "npc";
  } else if (isRealNode) {
    kindLabel = "node";
  } else {
    kindLabel = String(e?.type ?? "entity");
  }

  const baseName = String(e?.name ?? e?.id ?? "entity");

  return { kindLabel, baseName, deadNpc };
}

export function classifyNearbyEntityForViewer(
  e: any,
  viewerSessionId: string
): { kindLabel: string; baseName: string; deadNpc: boolean } | null {
  return classifyNearbyEntity(e, viewerSessionId);
}




type BuildSnapshotOpts = {
  entities: any[];
  viewerSessionId: string;
  originX: number;
  originZ: number;
  radius: number;
  excludeEntityId?: string | null;
  limit?: number;
};

export function buildNearbyTargetSnapshot(opts: BuildSnapshotOpts): NearbySnapshotEntry[] {
  const entities = Array.isArray(opts.entities) ? opts.entities : [];
  const viewerSessionId = String(opts.viewerSessionId ?? "");
  const originX = Number.isFinite(opts.originX) ? opts.originX : 0;
  const originZ = Number.isFinite(opts.originZ) ? opts.originZ : 0;
  const radius = Number.isFinite(opts.radius) ? opts.radius : 0;
  const excludeId = opts.excludeEntityId ? String(opts.excludeEntityId) : "";
  const limit = Math.max(1, Math.min(200, Number.isFinite(opts.limit as any) ? (opts.limit as number) : 200));

  if (!entities.length || radius <= 0) return [];

  const work: Array<{ e: any; dist: number; kindLabel: string; baseName: string; deadNpc: boolean }> = [];

  for (const e of entities) {
    if (!e || !e.id) continue;
    if (excludeId && String(e.id) === excludeId) continue;

    const { x: ex, z: ez } = getEntityXZ(e);
    const dist = distanceXZ(ex, ez, originX, originZ);
    if (dist > radius) continue;

    const meta = classifyNearbyEntity(e, viewerSessionId);
    if (!meta) continue;

    work.push({ e, dist, kindLabel: meta.kindLabel, baseName: meta.baseName, deadNpc: meta.deadNpc });
  }

  // Default nearby ordering: dist asc; if tied, alive first, then name/id.
  work.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.deadNpc !== b.deadNpc) return a.deadNpc ? 1 : -1;

    const an = a.baseName.toLowerCase();
    const bn = b.baseName.toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return String(a.e?.id ?? "").localeCompare(String(b.e?.id ?? ""));
  });

  const shortCounts = new Map<string, number>();

  const snapshot: NearbySnapshotEntry[] = [];

  for (const it of work.slice(0, limit)) {
    const shortBase = makeShortHandleBase(it.baseName);
    const key = `${it.kindLabel}:${shortBase}`;
    const n = (shortCounts.get(key) ?? 0) + 1;
    shortCounts.set(key, n);

    snapshot.push({
      e: it.e,
      dist: it.dist,
      kindLabel: it.kindLabel,
      baseName: it.baseName,
      handle: `${shortBase}.${n}`,
    });
  }

  return snapshot;
}

export function resolveNearbyHandleInRoom(opts: BuildSnapshotOpts & { handleRaw: string }): HandleResolved | null {
  const token = String(opts.handleRaw ?? "").trim();
  if (!token) return null;

  // Require the dotted form for this resolver (matches "nearby" output).
  if (!/^[a-z0-9_]+\.[0-9]+$/i.test(token)) return null;

  const snapshot = buildNearbyTargetSnapshot(opts);
  if (!snapshot.length) return null;

  const want = token.toLowerCase();

  // IMPORTANT: do NOT overwrite on collisions. First match in nearby ordering wins.
  const hit = snapshot.find((x) => String(x.handle ?? "").toLowerCase() === want);
  if (!hit) return null;

  return { entity: hit.e, dist: hit.dist, handle: hit.handle };
}
