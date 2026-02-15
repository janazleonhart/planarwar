// worldcore/quests/QuestCommandText.ts

import type { QuestDefinition } from "./QuestTypes";

export type RenderQuestMatchListOpts = {
  header: string;
  max?: number;
  /** Prefix each row with this string (default: " - "). */
  bullet?: string;
};

export function renderQuestMatchList(matches: QuestDefinition[], opts: RenderQuestMatchListOpts): string {
  const header = String(opts.header ?? "").trimEnd();
  const max = Number.isFinite(opts.max) ? Math.max(0, Number(opts.max)) : 8;
  const bullet = opts.bullet ?? " - ";

  const lines: string[] = [];
  if (header) lines.push(header);

  matches.slice(0, max).forEach((q) => {
    const name = String(q?.name ?? q?.id ?? "(unknown)");
    const id = String(q?.id ?? "");
    lines.push(`${bullet}${name}${id ? ` (${id})` : ""}`);
  });

  if (matches.length > max) {
    lines.push(`${bullet}...and ${matches.length - max} more`);
  }

  return lines.join("\n").trimEnd();
}

export function renderQuestAmbiguous(matches: QuestDefinition[], header = "[quest] Ambiguous. Did you mean:"): string {
  return renderQuestMatchList(matches, { header, max: 8, bullet: " - " });
}

export function renderQuestDidYouMean(matches: QuestDefinition[], header = "Did you mean:"): string {
  return renderQuestMatchList(matches, { header, max: 8, bullet: " - " });
}
