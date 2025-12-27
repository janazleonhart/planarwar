// worldcore/mud/commands/player/melodyCommand.ts

import type { CharacterState } from "../../../characters/CharacterTypes";
import type { MudContext } from "../../MudContext";

import {
  getMelody,
  addSongToMelody,
  removeSongFromMelody,
  clearMelody,
  setMelodyActive,
} from "../../../songs/SongEngine";

import {
  findSpellByNameOrId,
  SpellDefinition,
} from "../../../spells/SpellTypes";

interface CommandInput {
  cmd: string;
  args: string[];
  parts: string[];
}

function ensureVirtuosoOrThrow(char: CharacterState): string | null {
  const classId = (char.classId ?? "").toLowerCase();
  if (classId !== "virtuoso") {
    return "Only Virtuosos can shape melodies (for now).";
  }
  return null;
}

function formatMelody(spells: SpellDefinition[]): string {
  if (spells.length === 0) {
    return "Your melody is empty.\nUse: melody add <song>";
  }

  const lines: string[] = [];
  lines.push("Your melody:");

  spells.forEach((s, idx) => {
    lines.push(
      `${idx + 1}. ${s.name} [${s.id}] (min level ${s.minLevel})`
    );
  });

  return lines.join("\n");
}

export async function handleMelodyCommand(
  _ctx: MudContext,
  char: CharacterState,
  input: CommandInput
): Promise<string> {
  const err = ensureVirtuosoOrThrow(char);
  if (err) return err;

  const [sub, ...rest] = input.args;

  const melodyState = getMelody(char);

  // Helper to resolve a spell by name/id and validate it's a Virtuoso song
  const resolveSong = (token: string): SpellDefinition | string => {
    const spell = findSpellByNameOrId(token);
    if (!spell) return `I don't know a song or spell called '${token}'.`;

    if (!spell.isSong) {
      return `'${spell.name}' is not a song.`;
    }

    // Restrict to Virtuoso songs for v0.1
    if ((spell.classId ?? "").toLowerCase() !== "virtuoso") {
      return `'${spell.name}' is not part of the Virtuoso songbook.`;
    }

    return spell;
  };

  // No subcommand: show status
  if (!sub) {
    // Show current queue + active flag
    const spells: SpellDefinition[] =
      melodyState.spellIds
        .map((id) => findSpellByNameOrId(id))
        .filter((s): s is SpellDefinition => !!s);

    const lines: string[] = [];
    lines.push(formatMelody(spells));
    lines.push("");
    lines.push(
      `Melody is currently: ${melodyState.isActive ? "active" : "inactive"}`
    );
    lines.push("");
    lines.push(
      "Subcommands: melody add <song>, melody remove <song>, melody clear, melody start, melody stop"
    );

    return lines.join("\n");
  }

  const subLower = sub.toLowerCase();

  switch (subLower) {
    case "add": {
      const token = rest.join(" ").trim();
      if (!token) {
        return "Usage: melody add <song>";
      }

      const resolved = resolveSong(token);
      if (typeof resolved === "string") return resolved;

      addSongToMelody(char, resolved.id);

      return `Added '${resolved.name}' to your melody.`;
    }

    case "remove": {
      const token = rest.join(" ").trim();
      if (!token) {
        return "Usage: melody remove <song>";
      }

      const resolved = resolveSong(token);
      if (typeof resolved === "string") return resolved;

      removeSongFromMelody(char, resolved.id);

      return `Removed '${resolved.name}' from your melody.`;
    }

    case "clear": {
      clearMelody(char);
      return "You dismiss your melody; it is now empty.";
    }

    case "start": {
      if (melodyState.spellIds.length === 0) {
        return "Your melody is empty. Add a song first with 'melody add <song>'.";
      }

      setMelodyActive(char, true);
      return "You begin weaving your melody. (Tick engine wiring TBD.)";
    }

    case "stop": {
      setMelodyActive(char, false);
      return "You let your melody fade out.";
    }

    default: {
      return "Unknown subcommand. Use: melody, melody add, melody remove, melody clear, melody start, melody stop.";
    }
  }
}
