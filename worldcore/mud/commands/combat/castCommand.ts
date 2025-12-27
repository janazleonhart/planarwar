//worldcore/mud/commands/combat/castCommand.ts

import { handleCastCommand } from "../../MudSpells";

export async function handleCastMudCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  if (input.parts.length < 2) return "Usage: cast <spell> [target]";

  const spellName = input.parts[1];
  const targetRaw = input.parts.slice(2).join(" ");

  return handleCastCommand(ctx, char, spellName, targetRaw);
}
