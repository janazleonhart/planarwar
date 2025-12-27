//worldcore/mud/commands/combat/abilitiesListCommand.ts

import { listKnownAbilitiesForChar } from "../../MudAbilities";

export async function handleAbilitiesListCommand(
  _ctx: any,
  char: any
): Promise<string> {
  const list = listKnownAbilitiesForChar(char);
  if (list.length === 0) return "You have not learned any abilities yet.";

  let out = "Abilities:\n";
  for (const a of list) {
    out += ` - ${a.name} (${a.id}, level ${a.minLevel}+) – ${a.description}\n`;
  }
  return out.trimEnd();
}
