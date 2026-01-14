// worldcore/mud/commands/gathering/lumberingCommand.ts

import { handleGatherAction } from "../../MudActions";

export async function handleLumberingCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw)
    return "Usage: log <target> (e.g. 'log stand.1' or 'log 2')";

  return handleGatherAction(ctx, char, targetNameRaw, "logging", "resource_wood");
}
