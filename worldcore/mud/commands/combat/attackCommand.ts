//worldcore/mud/commands/combat/attackCommand.ts

import { handleAttackAction } from "../../MudActions";

export async function handleAttackCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = String(input.args.join(" ") ?? "").trim();

  // Behavior:
  // - `attack <target>` engages that target.
  // - `attack` (no args) swings at your engaged target (deny-by-default).
  if (!targetNameRaw) {
    return handleAttackAction(ctx, char, "");
  }

  return handleAttackAction(ctx, char, targetNameRaw);
}
