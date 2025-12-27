//worldcore/mud/commands/meta/helpCommand.ts

import { HELP_ENTRIES } from "../../MudHelpMenu";
import { getStaffRole } from "../../../shared/AuthTypes";

function isDebugAllowed(ctx: any): boolean {
  const identity = ctx?.session?.identity;
  if (!identity) return false;
  const role = getStaffRole(identity.flags);
  return role === "owner" || role === "dev" || role === "gm";
}

export async function handleHelpCommand(ctx: any): Promise<string> {
  const allowDebug = isDebugAllowed(ctx);

  const lines: string[] = [];
  lines.push("Available commands:");

  for (const entry of HELP_ENTRIES) {
    if (entry.debug && !allowDebug) continue;
    lines.push(`  ${entry.cmd.padEnd(24, " ")} - ${entry.desc}`);
  }

  return lines.join("\n");
}