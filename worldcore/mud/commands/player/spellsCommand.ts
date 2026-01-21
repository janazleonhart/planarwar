// worldcore/mud/commands/player/spellsCommand.ts

import type { MudContext } from "../../MudContext";
import { getKnownSpellsForChar } from "../../../spells/SpellTypes";

function fmtMs(ms: number | undefined): string {
  const n = Number(ms ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `${(n / 1000).toFixed(1)}s`;
}

export async function handleSpellsCommand(ctx: MudContext): Promise<string> {
  const char = ctx.session.character;
  if (!char) {
    return "You do not have an active character.";
  }

  const spells = getKnownSpellsForChar(char, { kind: "spells" });

  if (spells.length === 0) {
    return "You do not know any spells yet.";
  }

  const lines = spells.map((s) => {
    const cost = s.resourceCost ?? 0;
    const res = s.resourceType ?? "mana";
    const cd = fmtMs(s.cooldownMs);
    return `- ${s.name} (${s.id}, L${s.minLevel}) [cost ${cost} ${res}, cd ${cd}] — ${s.description}`;
  });

  return `Spells:\n${lines.join("\n")}`;
}
