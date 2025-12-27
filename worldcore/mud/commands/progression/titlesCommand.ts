//worldcore/mud/commands/progression/titlesCommand.ts

import { renderCurrentTitle, renderTitlesList } from "../../../progression/titles/titleText";
import { setActiveTitle } from "../../../progression/titles/setActiveTitle";

export async function handleTitleCommand(_ctx: any, char: any): Promise<string> {
  return renderCurrentTitle(char);
}

export async function handleTitlesCommand(_ctx: any, char: any): Promise<string> {
  return renderTitlesList(char);
}

export async function handleSetTitleCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const raw = input.args.join(" ");
  return setActiveTitle(ctx, char, raw);
}
