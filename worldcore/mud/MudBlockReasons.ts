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

  if (reason === "cc_dr_immune" || reason === "cc_immune") {
    return formatTargetImmuneLine({ kind: opts?.kind, name: opts?.name });
  }

  const verb = opts?.verb;
  const namePrefix = opts?.name
    ? (opts?.kind === "spell"
      ? `[world] [spell:${opts.name}] `
      : opts?.kind === "ability"
        ? `[world] [ability:${opts.name}] `
        : "[world] ")
    : "[world] ";

  if (verb === "cleanse") {
    if (reason === "cleanse_none") {
      if (opts?.targetIsSelf) return `${namePrefix}Nothing clings to you.`;
      if (opts?.targetDisplayName) return `${namePrefix}${opts.targetDisplayName} has nothing to cleanse.`;
      return `${namePrefix}Nothing to cleanse.`;
    }
    if (reason === "cleanse_protected") {
      return `${namePrefix}The effect resists cleansing.`;
    }
    if (reason === "cleanse_filtered") {
      return `${namePrefix}Nothing you can cleanse.`;
    }
  }

  if (verb === "dispel") {
    if (reason === "dispel_none") {
      if (opts?.targetDisplayName) return `${namePrefix}${opts.targetDisplayName} has nothing to dispel.`;
      return `${namePrefix}Nothing to dispel.`;
    }
    if (reason === "dispel_protected") {
      return `${namePrefix}The effect resists dispelling.`;
    }
    if (reason === "dispel_filtered") {
      return `${namePrefix}Nothing you can dispel.`;
    }
  }

  if (reason === "status_already_present") {
  return `${namePrefix}That effect is already present.`;
}

// Conservative generic fallback.
  return "[world] It fails.";
}
