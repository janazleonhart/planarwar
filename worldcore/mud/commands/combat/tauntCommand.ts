// worldcore/mud/commands/combat/tauntCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

import { handleTauntAction } from "../../actions/MudCombatActions";

export async function handleTauntCommand(
  ctx: MudContext,
  char: CharacterState,
  input: { cmd: string; args: string[]; parts: string[] },
): Promise<string> {
  const targetNameRaw = String(input.args.join(" ") ?? "").trim();

  // Behavior:
  // - `taunt <target>` taunts that target
  // - `taunt` uses your engaged target (deny-by-default)
  return handleTauntAction(ctx, char, targetNameRaw);
}
