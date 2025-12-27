// worldcore/mud/commands/player/songsCommand.ts

import type { MudContext } from "../../MudContext";
import { SPELLS, type SpellDefinition } from "../../../spells/SpellTypes";

export async function handleSongsCommand(
  ctx: MudContext
): Promise<string> {
  const char = ctx.session.character;

  if (!char) {
    return "You do not have an active character.";
  }

  const classId = (char.classId ?? "").toLowerCase();
  const level = char.level ?? 1;

  // Songs:
  //  - isSong === true
  //  - classId matches, or is "any"
  //  - minLevel <= your level
  const songs: SpellDefinition[] = Object.values(SPELLS)
    .filter((s) => s.isSong === true)
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

  if (songs.length === 0) {
    return "You do not know any songs yet.";
  }

  const lines = songs.map((s) => {
    const lvl = s.minLevel ?? 1;
    const id = s.id;
    const desc = s.description ?? "";
    return `- ${s.name} (${id}, level ${lvl}+) – ${desc}`;
  });

  return `Songs:\n${lines.join(" ")}`;
}
