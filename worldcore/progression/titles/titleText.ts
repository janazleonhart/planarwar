//worldcore/progression/titles/titleText.ts

import { ensureTitlesContainer } from "./titleState";
import { TITLES } from "../../characters/TitleTypes"

export function renderCurrentTitle(char: any): string {
  const titlesState = ensureTitlesContainer(char);
  const activeId = titlesState.active;

  if (!activeId) {
    return "You have no active title. Use 'titles' to list them and 'settitle <id>' to choose one.";
  }

  const def = TITLES[activeId];
  const name = def?.name ?? activeId;
  const desc = def?.description ?? "";

  let line = `Current title: ${name} (${activeId})`;
  if (desc) line += ` - ${desc}`;
  return line;
}

export function renderTitlesList(char: any): string {
  const titlesState = ensureTitlesContainer(char);
  const unlocked = titlesState.unlocked;

  if (!unlocked || unlocked.length === 0) {
    return "You have not unlocked any titles yet.";
  }

  let out = "Titles:\n";
  for (const id of unlocked) {
    const def = TITLES[id];
    const mark = titlesState.active === id ? "*" : " ";
    const name = def?.name ?? id;
    const desc = def?.description ?? "";
    out += ` ${mark} ${name} (${id})`;
    if (desc) out += ` - ${desc}`;
    out += "\n";
  }

  return out.trimEnd();
}
