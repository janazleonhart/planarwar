// worldcore/mud/commands/gathering/fishingCommand.ts

import { handleGatherAction } from "../../MudActions";

export async function handleFishingCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw)
    return "Usage: fish <target> (e.g. 'fish pool.1' or 'fish 2')";

  return handleGatherAction(ctx, char, targetNameRaw, "fishing", "resource_fish");
}
