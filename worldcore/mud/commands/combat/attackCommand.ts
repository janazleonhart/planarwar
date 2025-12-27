//worldcore/mud/commands/combat/attackCommand.ts

import { handleAttackAction } from "../../MudActions";

export async function handleAttackCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw) return "Usage: attack <targetName>";
  return handleAttackAction(ctx, char, targetNameRaw);
}
