// worldcore/mud/commands/gathering/pickingCommand.ts

import { handleGatherAction } from "../../MudActions";

export async function handlePickingCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw) return "Usage: pick <target> (e.g. 'pick patch.1' or 'pick 2')";

  return handleGatherAction(ctx, char, targetNameRaw, "herbalism", "resource_herb");
}
