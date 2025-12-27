//worldcore/progression/titles/setActiveTitle.ts

import { Logger } from "../../utils/logger";
import { ensureTitlesContainer } from "../../mud/MudProgression";
import { TITLES } from "../../characters/TitleTypes"

const log = Logger.scope("Titles");

export async function setActiveTitle(
  ctx: any,
  char: any,
  rawId: string
): Promise<string> {
  const raw = String(rawId ?? "").trim();
  if (!raw) return "Usage: settitle <id>";

  // keep your current behavior: spaces become underscores, lowercased
  const needle = raw.split(/\s+/).join("_").toLowerCase();

  const titlesState = ensureTitlesContainer(char);
  const match = titlesState.unlocked.find((id: string) => id.toLowerCase() === needle);

  if (!match) return "You don't have that title unlocked.";

  titlesState.active = match;

  if (ctx.characters) {
    try {
      await ctx.characters.patchCharacter(char.userId, char.id, {
        progression: char.progression,
      });
    } catch (err) {
      log.warn("Failed to patch progression after settitle", {
        err: String(err),
        charId: char.id,
        titleId: match,
      });
    }
  }

  const def = TITLES[match];
  const name = def?.name ?? match;
  return `You now bear the title '${name}'.`;
}
