// worldcore/mud/commands/player/statsCommand.ts

import { buildCharacterSheetLine } from "../../../characters/characterSheet";
import { ensureTitlesContainer } from "../../MudProgression";
import { TITLES } from "../../../characters/TitleTypes"

export async function handleStatsCommand(
  ctx: any,
  char: any,
  _input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const selfEntity = ctx.entities?.getEntityByOwner?.(ctx.session.id) ?? null;

  const titlesState = ensureTitlesContainer(char);
  const getActiveTitleName = () => {
    if (!titlesState.active) return null;
    const def = TITLES[titlesState.active];
    return def?.name ?? titlesState.active;
  };

  return buildCharacterSheetLine(char, {
    items: ctx.items,
    selfEntity,
    getActiveTitleName,
  });
}