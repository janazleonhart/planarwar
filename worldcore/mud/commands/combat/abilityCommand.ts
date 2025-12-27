//worldcore/mud/commands/combat/abilityCommand.ts

import { handleAbilityCommand } from "../../MudAbilities";

export async function handleAbilityMudCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  if (input.parts.length < 2) return "Usage: ability <name> [target]";

  const abilityName = input.parts[1];
  const targetRaw = input.parts.slice(2).join(" ");

  return handleAbilityCommand(ctx, char, abilityName, targetRaw);
}
