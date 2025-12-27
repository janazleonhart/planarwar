//worldcore/targeting/TargetResolver.ts

import type { Entity } from "../shared/Entity";

export type EntityProvider = {
  getEntitiesInRoom(roomId: string): Entity[];
};

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

const makeShort = (name: string): string => {
  const words = norm(name).split(/\s+/).filter(Boolean);
  return words[words.length - 1] ?? "thing";
};

export function resolveTargetInRoom(
  entities: EntityProvider,
  roomId: string,
  raw: string,
  opts: {
    selfId?: string;
    filter: (e: Entity) => boolean;
  }
): Entity | null {
  const r = String(raw ?? "").trim();
  if (!r) return null;

  const all = entities.getEntitiesInRoom(roomId) ?? [];
  const candidates = all
    .filter((e) => e && e.id && e.id !== opts.selfId)
    .filter((e) => opts.filter(e))
    .map((e) => ({ e, name: String(e.name ?? e.id) }))
    .sort((a, b) => {
      const an = norm(a.name);
      const bn = norm(b.name);
      if (an !== bn) return an.localeCompare(bn);
      return String(a.e.id).localeCompare(String(b.e.id));
    });

  if (candidates.length === 0) return null;

  // Case 1: "2"
  if (/^\d+$/.test(r)) {
    const idx = Math.max(1, parseInt(r, 10)) - 1;
    return candidates[idx]?.e ?? null;
  }

  // Case 2: "vein.1" / "vein#1"
  const m = r.match(/^(.+?)[.#](\d+)$/);
  if (m) {
    const want = Math.max(1, parseInt(m[2], 10)) - 1;
    const namePart = norm(m[1]);
    const matches = candidates.filter((c) => {
      const s = makeShort(c.name);
      return s.includes(namePart) || norm(c.name).includes(namePart);
    });
    return matches[want]?.e ?? null;
  }

  // Case 3: partial match
  const namePart = norm(r);
  const first = candidates.find((c) => {
    const s = makeShort(c.name);
    return s.includes(namePart) || norm(c.name).includes(namePart);
  });

  return first?.e ?? null;
}
