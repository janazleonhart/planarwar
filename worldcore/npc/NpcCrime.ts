import type { CharacterState } from "../characters/CharacterTypes";
import type { NpcPrototype, NpcRuntimeState } from "./NpcTypes";
import { getGuardCallRadius, DEFAULT_GUARD_CALL_RADIUS } from "./NpcTypes";
import { getNpcPrototype } from "./NpcTypes";

const CRIME_GRACE_MS = 15_000;
const CRIME_SEVERE_MS = 90_000;

export type CrimeSeverity = "minor" | "severe";

export function isProtectedNpc(proto?: NpcPrototype | null): boolean {
  const tags = proto?.tags ?? [];
  return (
    tags.includes("protected_town") ||
    tags.includes("civilian") ||
    tags.includes("town_npc") ||
    tags.includes("non_hostile")
  );
}

export function recordNpcCrimeAgainst(
  npc: NpcRuntimeState,
  attacker: CharacterState,
  opts: { lethal: boolean; proto?: NpcPrototype | null }
): void {
  const proto = opts.proto ?? getNpcPrototype(npc.templateId) ?? getNpcPrototype(npc.protoId);
  if (!isProtectedNpc(proto)) return;

  const now = Date.now();
  const existingUntil = attacker.recentCrimeUntil ?? 0;
  const alreadyWanted = existingUntil > now;
  const severity: CrimeSeverity = opts.lethal || alreadyWanted ? "severe" : "minor";
  const duration = severity === "severe" ? CRIME_SEVERE_MS : CRIME_GRACE_MS;

  attacker.recentCrimeUntil = now + duration;
  attacker.recentCrimeSeverity = severity;
}

export function resolveGuardCallRadius(
  profile: NonNullable<NpcPrototype["guardProfile"]> | undefined,
  override?: number,
): number | undefined {
  return getGuardCallRadius(profile, override) ?? DEFAULT_GUARD_CALL_RADIUS.town;
}
