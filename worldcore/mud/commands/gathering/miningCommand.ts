// worldcore/mud/commands/gathering/miningCommand.ts

import { handleGatherAction } from "../../MudActions";

export async function handleMiningCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw)
    return "Usage: mine <target> (e.g. 'mine vein.1' or 'mine 2')";

  // Mining covers ore + mana clusters.
  return handleGatherAction(ctx, char, targetNameRaw, "mining", [
    "resource_ore",
    "resource_mana",
  ]);
}
