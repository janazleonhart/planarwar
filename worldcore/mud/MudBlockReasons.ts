// worldcore/mud/MudBlockReasons.ts
//
// Central mapping from engine-side "blockedReason" codes to player-facing MUD lines.
// Keep this tiny + stable: contract tests may assert exact strings.

import { formatTargetImmuneLine, type MudImmuneLineKind } from "./MudLines";

export type MudBlockedReason = string;

/**
 * Format a user-facing line for a blocked action/effect.
 *
 * NOTE: Today only `cc_dr_immune` is used. This helper exists to keep future
 * blockers from creating string drift across spell/ability code paths.
 */
export function formatBlockedReasonLine(opts?: {
  reason?: MudBlockedReason;
  kind?: MudImmuneLineKind;
  name?: string;
}): string {
  const reason = (opts?.reason ?? "").trim();

  if (reason === "cc_dr_immune") {
    return formatTargetImmuneLine({ kind: opts?.kind, name: opts?.name });
  }

  // Conservative generic fallback.
  return "[world] It fails.";
}
