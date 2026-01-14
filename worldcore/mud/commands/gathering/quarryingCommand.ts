// worldcore/mud/commands/gathering/quarryingCommand.ts

import { handleGatherAction } from "../../MudActions";

export async function handleQuarryingCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw)
    return "Usage: quarry <target> (e.g. 'quarry outcrop.1' or 'quarry 2')";

  return handleGatherAction(ctx, char, targetNameRaw, "quarrying", "resource_stone");
}
