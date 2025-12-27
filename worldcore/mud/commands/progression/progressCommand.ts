//worldcore/mud/commands/progression/progressCommand.ts

import { renderProgressText } from "../../../progression/progressText";

export async function handleProgressCommand(_ctx: any, char: any): Promise<string> {
  return renderProgressText(char);
}
