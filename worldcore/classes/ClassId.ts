// worldcore/classes/ClassId.ts
//
// Small shared helper for runtime-facing class ids.
//
// Why this exists:
// - DB / admin / Mother Brain creation paths may still use MMO-prefixed ids like
//   "pw_class_warlord".
// - Gameplay runtime systems (spell kits, abilities, resources) generally expect
//   canonical ids like "warlord".
//
// Slice A policy:
// - normalize once at session attach / hydrate boundary
// - also allow defensive lookup normalization in systems that still receive mixed ids

export function normalizeRuntimeClassId(classId: string | undefined | null): string {
  const raw = String(classId ?? "").toLowerCase().trim();
  if (!raw) return "";
  if (raw.startsWith("pw_class_")) return raw.slice("pw_class_".length);
  if (raw.startsWith("pwclass_")) return raw.slice("pwclass_".length);
  return raw;
}

export function normalizeRuntimeCharacterClassInPlace<T extends { classId?: any } | null | undefined>(char: T): T {
  if (!char || typeof char !== "object") return char;
  const next = normalizeRuntimeClassId((char as any).classId);
  if (next) (char as any).classId = next;
  return char;
}
