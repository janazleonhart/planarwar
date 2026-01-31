// worldcore/npc/NpcCrime.ts
//
// Justice / "crime" bookkeeping used by guard AI. This is intentionally simple:
//
// - A "protected NPC" (civilian/vendor/questgiver etc.) being attacked sets a short "wanted" timer.
// - Guards can react based on severity (minor vs severe) and the timer.
//
// Key rules:
// - Training dummies are ALWAYS exempt (tag: "training").
// - Any NPC tagged "law_exempt" is ALWAYS exempt.
// - Prototype lookup tolerates instance suffixes like "civilian.1" by stripping a trailing ".<digits>".

import type { CharacterState } from "../characters/CharacterTypes";
import type { GuardProfile, NpcPrototype, NpcRuntimeState } from "./NpcTypes";
import {
  DEFAULT_GUARD_CALL_RADIUS,
  getGuardCallRadius,
  getNpcPrototype,
} from "./NpcTypes";
import { Logger } from "../utils/logger";

const crimeLog = Logger.scope("NPCCRIME");

// How long a player is considered "wanted" after committing a minor vs severe crime.
const CRIME_GRACE_MS = 15_000;
const CRIME_SEVERE_MS = 90_000;

export type CrimeSeverity = "minor" | "severe";

// Option B: explicit law tags.
// - law_exempt wins over everything (quests, corrupted guards, special cases).
// - law_protected marks an NPC as protected even if it would otherwise not match.
const LAW_TAG_EXEMPT = "law_exempt";
const LAW_TAG_PROTECTED = "law_protected";

// Legacy protection tags still used by older DB rows + tests.
// These behave like `law_protected` unless overridden by `law_exempt`.
const LEGACY_PROTECTED_TAGS = new Set<string>([
  "protected_town",
  "protected_outpost",
  "protected_wilds",
]);

// Tags that count as "citizens / protected things" guards will defend.
// (law_* tags handled separately for precedence.)
const DEFAULT_PROTECTED_TAGS = new Set<string>([
  "civilian", // generic townfolk
  "protected", // generic future hook
  "vendor",
  "questgiver",
  "non_hostile", // safe fluff NPCs (NOT training dummies)
  ...Array.from(LEGACY_PROTECTED_TAGS),
]);

function tagsOf(proto: NpcPrototype | null | undefined): Set<string> {
  if (!proto?.tags?.length) return new Set();
  return new Set(proto.tags.map((t) => String(t).trim()).filter(Boolean));
}

/**
 * Decide whether an NPC counts as a "protected" target for crime purposes.
 *
 * Precedence (Option B):
 *  1) law_exempt      => NOT protected
 *  2) training        => NOT protected
 *  3) law_protected   => protected
 *  4) legacy/default protected tags => protected
 *
 * Notes:
 * - Resource nodes are never protected.
 * - Guards are enforcers, not protected civilians.
 */
export function isProtectedNpc(proto: NpcPrototype | null | undefined): boolean {
  if (!proto) return false;

  const tags = tagsOf(proto);

  // World objects, not citizens.
  if (tags.has("resource")) return false;

  // Enforcers, not protected civilians.
  if (tags.has("guard")) return false;

  // Training dummies exist to be hit. They are not crimes.
  if (tags.has("training")) return false;

  // Option B precedence.
  if (tags.has(LAW_TAG_EXEMPT)) return false;
  if (tags.has(LAW_TAG_PROTECTED)) return true;

  for (const t of tags) {
    if (DEFAULT_PROTECTED_TAGS.has(t)) return true;
  }

  return false;
}

export type CrimeRecord = {
  /** Optional resolved prototype; if absent we will attempt to resolve from the runtime state. */
  proto?: NpcPrototype | null;
  /** If provided, overrides lethal detection. */
  lethal?: boolean;
  /** If provided (and lethal is not), lethal is inferred by newHp <= 0. */
  newHp?: number;
};

export type CrimeResult = {
  severity: CrimeSeverity;
  guardProfile: GuardProfile | undefined;
  guardCallRadius: number;
};

function normalizeProtoId(id: string): string {
  // Only strip a trailing ".<digits>" instance suffix, e.g. "civilian.1" -> "civilian".
  return id.replace(/\.\d+$/, "");
}

function resolveNpcProtoFromRuntime(npc: NpcRuntimeState): NpcPrototype | null {
  const ids: string[] = [];
  if (typeof npc.templateId === "string" && npc.templateId) ids.push(npc.templateId);
  if (typeof npc.protoId === "string" && npc.protoId) ids.push(npc.protoId);

  for (const raw of ids) {
    const direct = getNpcPrototype(raw);
    if (direct) return direct;

    const norm = normalizeProtoId(raw);
    if (norm !== raw) {
      const normalized = getNpcPrototype(norm);
      if (normalized) return normalized;
    }
  }

  return null;
}

/**
 * Record a crime on the attacker character state.
 *
 * Returns a small summary the guard AI can use (severity + call radius),
 * or null when no crime was recorded.
 */
export function recordNpcCrimeAgainst(
  npc: NpcRuntimeState,
  attacker: CharacterState,
  record: CrimeRecord,
): CrimeResult | null {
  const proto = record.proto ?? resolveNpcProtoFromRuntime(npc);

  // If we truly can't find a proto, bail safely.
  if (!proto) {
    crimeLog.warn("recordNpcCrimeAgainst: missing NPC prototype", {
      npcEntityId: (npc as any).entityId,
      npcTemplateId: (npc as any).templateId,
      npcProtoId: (npc as any).protoId,
    });
    return null;
  }

  // Skip anything that isn't a protected citizen.
  if (!isProtectedNpc(proto)) return null;

  const now = Date.now();
  const existingUntil = attacker.recentCrimeUntil ?? 0;
  const alreadyWanted = existingUntil > now;

  const lethal =
    typeof record.lethal === "boolean"
      ? record.lethal
      : typeof record.newHp === "number"
        ? record.newHp <= 0
        : false;

  const severity: CrimeSeverity = lethal || alreadyWanted ? "severe" : "minor";
  const duration = severity === "severe" ? CRIME_SEVERE_MS : CRIME_GRACE_MS;

  attacker.recentCrimeUntil = now + duration;
  attacker.recentCrimeSeverity = severity;

  // Guard call radius: optional per-proto override.
  const profile = (proto as any).guardProfile as GuardProfile | undefined;
  const override =
    typeof (proto as any).guardCallRadius === "number"
      ? ((proto as any).guardCallRadius as number)
      : undefined;

  const guardCallRadius = resolveGuardCallRadius(profile, override);

  crimeLog.info("Recorded NPC crime", {
    npcEntityId: (npc as any).entityId,
    npcProtoId: proto.id,
    npcTags: proto.tags ?? [],
    attackerCharacterId: attacker.id,
    lethal,
    severity,
    until: attacker.recentCrimeUntil,
    guardCallRadius,
  });

  return { severity, guardProfile: profile, guardCallRadius };
}

/**
 * Helper for resolving the actual guard call radius with a fallback.
 */
export function resolveGuardCallRadius(
  profile: GuardProfile | undefined,
  override?: number,
): number {
  return getGuardCallRadius(profile, override) ?? DEFAULT_GUARD_CALL_RADIUS.town;
}
