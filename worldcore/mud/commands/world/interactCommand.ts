//worldcore/mud/commands/world/interactCommand.ts

import { interactInRoom } from "../../../interaction/interactOps";
import { renderQuestLog } from "../../MudProgression";

export async function handleInteractCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const what = input.args.join(" ").trim();

  const res = interactInRoom(
    ctx,
    char,
    { what, roomIdFallback: char.shardId },
    { renderQuestLog }
  );

  return res.ok ? res.text : res.reason;
}
