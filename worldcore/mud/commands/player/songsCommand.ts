// worldcore/mud/commands/player/songsCommand.ts

import type { MudContext } from "../../MudContext";
import { getKnownSpellsForChar } from "../../../spells/SpellTypes";

function fmtMs(ms: number | undefined): string {
  const n = Number(ms ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `${(n / 1000).toFixed(1)}s`;
}

export async function handleSongsCommand(ctx: MudContext): Promise<string> {
  const char = ctx.session.character;
  if (!char) {
    return "You do not have an active character.";
  }

  const songs = getKnownSpellsForChar(char, { kind: "songs" });

  if (songs.length === 0) {
    return "You do not know any songs yet.";
  }

  const lines = songs.map((s) => {
    const school = (s.songSchool ?? "-").toString();
    const cost = s.resourceCost ?? 0;
    const res = s.resourceType ?? "mana";
    const cd = fmtMs(s.cooldownMs);
    return `- ${s.name} (${s.id}, L${s.minLevel}) [${school}, cost ${cost} ${res}, cd ${cd}] — ${s.description}`;
  });

  return `Songs:\n${lines.join("\n")}`;
}
