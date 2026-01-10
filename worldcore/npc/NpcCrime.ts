// worldcore/npc/NpcCrime.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type {
  GuardProfile,
  NpcPrototype,
  NpcRuntimeState,
} from "./NpcTypes";
import {
  DEFAULT_GUARD_CALL_RADIUS,
  getGuardCallRadius,
  getNpcPrototype,
} from "./NpcTypes";
import { Logger } from "../utils/logger";

const crimeLog = Logger.scope("NPCCRIME");

const CRIME_GRACE_MS = 15_000;
const CRIME_SEVERE_MS = 90_000;

export type CrimeSeverity = "minor" | "severe";

/**
 * Decide whether an NPC counts as a "protected" target for crime purposes.
 *
 * Protected = town civs, vendors, quest givers, etc.
 * Not protected = beasts, bandits, resource nodes, guards themselves, etc.
 */
export function isProtectedNpc(
  proto: NpcPrototype | null | undefined,
): boolean {
  if (!proto) return false;

  const tags = new Set(proto.tags ?? []);

  // Resource nodes are world objects, not citizens.
  // Hitting a Peacebloom patch or ore vein should never be a crime.
  if (tags.has("resource")) return false;

  // Guards are enforcers, not protected civilians.
  if (tags.has("guard")) return false;

  // Tags that count as "citizens / protected things" the guards will defend.
  const PROTECTED_TAGS = new Set<string>([
    "civilian",        // generic townfolk / dummies
    "protected",       // generic future hook
    "protected_town",  // town rats, pigeons, etc
    "vendor",
    "questgiver",
    "non_hostile",     // safe fluff NPCs
  ]);

  for (const t of tags) {
    if (PROTECTED_TAGS.has(t)) {
      return true;
    }
  }

  return false;
}

/**
 * Mark a crime on the attacker for hitting a protected NPC.
 */
export function recordNpcCrimeAgainst(
  npc: NpcRuntimeState,
  attacker: CharacterState,
  opts: { lethal: boolean; proto?: NpcPrototype | null },
): void {
  const proto =
    opts.proto ??
    getNpcPrototype(npc.templateId) ??
    getNpcPrototype(npc.protoId);

  // If we truly can't find a proto, just bail out safely.
  if (!proto) {
    crimeLog.warn("recordNpcCrimeAgainst: missing NPC prototype", {
      npcEntityId: (npc as any).entityId,
      npcTemplateId: npc.templateId,
      npcProtoId: npc.protoId,
    });
    return;
  }

  // Skip anything that isn't a protected citizen (including resource nodes).
  if (!isProtectedNpc(proto)) {
    // Optional debug spam if we ever need it:
    // crimeLog.debug("NPC is not protected; no crime recorded", {
    //   protoId: proto.id,
    //   tags: proto.tags ?? [],
    // });
    return;
  }

  const now = Date.now();
  const existingUntil = attacker.recentCrimeUntil ?? 0;
  const alreadyWanted = existingUntil > now;
  const lethal = opts.lethal;

  const severity: CrimeSeverity =
    lethal || alreadyWanted ? "severe" : "minor";

  const duration = severity === "severe" ? CRIME_SEVERE_MS : CRIME_GRACE_MS;

  attacker.recentCrimeUntil = now + duration;
  attacker.recentCrimeSeverity = severity;

  crimeLog.info("Recorded NPC crime", {
    npcEntityId: (npc as any).entityId,
    npcProtoId: proto.id,
    npcTags: proto.tags ?? [],
    attackerCharacterId: attacker.id,
    lethal,
    severity,
    until: attacker.recentCrimeUntil,
  });
}

/**
 * Helper for resolving the actual guard call radius with a fallback.
 */
export function resolveGuardCallRadius(
  profile: GuardProfile | undefined,
  override?: number,
): number | undefined {
  return (
    getGuardCallRadius(profile, override) ?? DEFAULT_GUARD_CALL_RADIUS.town
  );
}
