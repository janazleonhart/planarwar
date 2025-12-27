// worldcore/mud/commands/combat/castCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

import { handleCastCommand } from "../../MudSpells";

interface CastInput {
  cmd: string;
  args: string[];
  parts: string[];
}

export async function handleCastMudCommand(
  ctx: MudContext,
  char: CharacterState,
  input: CastInput
): Promise<string> {
  if (!input.parts || input.parts.length < 2) {
    return "Usage: cast <spell> [target]";
  }

  const spellName = input.parts[1];
  const targetRaw = input.parts.slice(2).join(" ");

  return handleCastCommand(ctx, char, spellName, targetRaw);
}
