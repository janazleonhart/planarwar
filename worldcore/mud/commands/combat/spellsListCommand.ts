//worldcore/mud/commands/combat/spellsListCommand.ts

import { listKnownSpellsForChar } from "../../MudSpells";

export async function handleSpellsListCommand(_ctx: any, char: any): Promise<string> {
  const list = listKnownSpellsForChar(char);

  if (list.length === 0) {
    return "You have not learned any spells yet.";
  }

  let out = "Spells:\n";
  for (const s of list) {
    out += ` - ${s.name} (${s.id}, level ${s.minLevel}+) – ${s.description}\n`;
  }
  return out.trimEnd();
}
