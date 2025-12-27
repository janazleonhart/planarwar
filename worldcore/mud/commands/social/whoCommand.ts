//worldcore/mud/commands/social/whoCommand.ts

import { formatRegionLabel } from "../../../world/regionText";

export async function handleWhoCommand(
  ctx: any,
  _char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const roomId = ctx.session.roomId;
  const all = getAllSessionsArray(ctx);

  const visible = all.filter((s: any) => {
    if (!s.character) return false;
    if (!roomId) return false;
    return s.roomId === roomId;
  });

  if (visible.length === 0) return "No other players are visible.";

  const lines = visible.map((s: any) => {
    const c = s.character!;
    return `- ${c.name} (${c.classId} ${c.level})`;
  });

  return lines.join("\n");
}

export async function handleWhoAllCommand(
  ctx: any,
  _char: any,
  _input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const all = getAllSessionsArray(ctx);
  const withChars = all.filter((s: any) => !!s.character);

  if (withChars.length === 0) return "No players are currently online.";

  const lines = withChars.map((s: any) => {
    const c = s.character!;
    const regionLabel = formatRegionLabel(c.lastRegionId);
    return `- ${c.name} (${c.classId} ${c.level}) – Region: ${regionLabel}`;
  });

  return lines.join("\n");
}

export async function handleWhoIsCommand(
  ctx: any,
  _char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  if (input.args.length === 0) return "Usage: whois <character name>";

  const needle = input.args.join(" ").toLowerCase();
  const all = getAllSessionsArray(ctx);

  const target = all.find((s: any) => {
    const c = s.character;
    if (!c) return false;
    return c.name.toLowerCase() === needle;
  });

  if (!target || !target.character) {
    return `No such character '${input.args.join(" ")}' is currently online.`;
  }

  const c = target.character;
  const regionLabel = formatRegionLabel(c.lastRegionId);
  const worldLabel = c.shardId ?? "prime_shard";

  return [
    `Name: ${c.name}`,
    `Class: ${c.classId}  Level: ${c.level}`,
    `World: ${worldLabel}`,
    `Region: ${regionLabel}`,
  ].join("\n");
}

function getAllSessionsArray(ctx: any): any[] {
    if (ctx.sessions?.values) return Array.from(ctx.sessions.values());
    if (ctx.sessions?.getAllSessions) return Array.from(ctx.sessions.getAllSessions());
    return [];
  }