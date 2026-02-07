// worldcore/mud/commands/combat/shootCommand.ts

import { handleRangedAttackAction } from "../../MudActions";

export async function handleShootCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = String(input.args.join(" ") ?? "").trim();
  return handleRangedAttackAction(ctx, char, targetNameRaw);
}
