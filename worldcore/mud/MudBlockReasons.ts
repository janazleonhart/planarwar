// worldcore/mud/MudBlockReasons.ts
//
// Central mapping from engine-side "blockedReason" codes to player-facing MUD lines.
// Keep this tiny + stable: contract tests may assert exact strings.

import { formatTargetImmuneLine, type MudImmuneLineKind } from "./MudLines";

export type MudBlockedReason = string;
export type MudBlockedVerb = "cleanse" | "dispel";

export function formatBlockedReasonLine(opts?: {
  reason?: MudBlockedReason;
  kind?: MudImmuneLineKind;
  name?: string;

  // Optional context for non-CC blockers.
  verb?: MudBlockedVerb;
  targetDisplayName?: string;
  targetIsSelf?: boolean;
}): string {
  const reason = (opts?.reason ?? "").trim();

  if (reason === "cc_dr_immune") {
    return formatTargetImmuneLine({ kind: opts?.kind, name: opts?.name });
  }

  const verb = opts?.verb;
  const spellPrefix = opts?.kind === "spell" && opts?.name
    ? `[world] [spell:${opts.name}] `
    : "[world] ";

  if (verb === "cleanse") {
    if (reason === "cleanse_none") {
      if (opts?.targetIsSelf) return `${spellPrefix}Nothing clings to you.`;
      if (opts?.targetDisplayName) return `${spellPrefix}${opts.targetDisplayName} has nothing to cleanse.`;
      return `${spellPrefix}Nothing to cleanse.`;
    }
    if (reason === "cleanse_protected") {
      return `${spellPrefix}The effect resists cleansing.`;
    }
    if (reason === "cleanse_filtered") {
      return `${spellPrefix}Nothing you can cleanse.`;
    }
  }

  if (verb === "dispel") {
    if (reason === "dispel_none") {
      if (opts?.targetDisplayName) return `${spellPrefix}${opts.targetDisplayName} has nothing to dispel.`;
      return `${spellPrefix}Nothing to dispel.`;
    }
    if (reason === "dispel_protected") {
      return `${spellPrefix}The effect resists dispelling.`;
    }
    if (reason === "dispel_filtered") {
      return `${spellPrefix}Nothing you can dispel.`;
    }
  }

  // Conservative generic fallback.
  return "[world] It fails.";
}
