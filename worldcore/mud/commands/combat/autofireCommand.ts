// worldcore/mud/commands/combat/autofireCommand.ts

import { startAutoFire, stopAutoFire, isAutoFireEnabledForSession } from "./autofire/autofire";

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

export async function handleAutoFireCommand(
  ctx: MudContext,
  char: CharacterState,
  input: { cmd: string; args: string[]; parts: string[] },
): Promise<string> {
  const arg0 = String(input?.args?.[0] ?? "").trim().toLowerCase();

  if (!arg0) {
    // Toggle when omitted.
    const enabled = isAutoFireEnabledForSession(ctx);
    return enabled ? stopAutoFire(ctx) : startAutoFire(ctx, char);
  }

  if (arg0 === "on" || arg0 === "enable" || arg0 === "1" || arg0 === "true") {
    return startAutoFire(ctx, char);
  }

  if (arg0 === "off" || arg0 === "disable" || arg0 === "0" || arg0 === "false") {
    return stopAutoFire(ctx);
  }

  if (arg0 === "toggle") {
    const enabled = isAutoFireEnabledForSession(ctx);
    return enabled ? stopAutoFire(ctx) : startAutoFire(ctx, char);
  }

  return "Usage: autofire [on|off|toggle]";
}
