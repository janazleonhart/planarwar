// worldcore/mud/commands/gathering/farmingCommand.ts

import { handleGatherAction } from "../../MudActions";

export async function handleFarmingCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw)
    return "Usage: farm <target> (e.g. 'farm patch.1' or 'farm 2')";

  return handleGatherAction(ctx, char, targetNameRaw, "farming", "resource_grain");
}
