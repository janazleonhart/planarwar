// worldcore/mud/commands/player/spellsCommand.ts

import type { MudContext } from "../../MudContext";
import { SPELLS, type SpellDefinition } from "../../../spells/SpellTypes";

export async function handleSpellsCommand(
  ctx: MudContext
): Promise<string> {
  const char = ctx.session.character;

  if (!char) {
    return "You do not have an active character.";
  }

  const classId = (char.classId ?? "").toLowerCase();
  const level = char.level ?? 1;

  // Only show spells:
  //  - that are not songs
  //  - that belong to this class, or are "any"
  //  - that you meet the min level for
  const spells: SpellDefinition[] = Object.values(SPELLS)
    .filter((s) => !s.isSong)
    .filter((s) => {
      const spellClass = (s.classId ?? "").toLowerCase();
      if (!spellClass || spellClass === "any") return true;
      return spellClass === classId;
    })
    .filter((s) => (s.minLevel ?? 1) <= level)
    .sort((a, b) => {
      if (a.minLevel !== b.minLevel) {
        return (a.minLevel ?? 1) - (b.minLevel ?? 1);
      }
      return a.name.localeCompare(b.name);
    });

  if (spells.length === 0) {
    return "You do not know any spells yet.";
  }

  const lines = spells.map((s) => {
    const lvl = s.minLevel ?? 1;
    const id = s.id;
    const desc = s.description ?? "";
    return `- ${s.name} (${id}, level ${lvl}+) – ${desc}`;
  });

  return `Spells:\n${lines.join(" ")}`;
}
