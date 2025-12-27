//worldcore/mud/PresenceCommands.ts

import { SessionManager } from "../core/SessionManager";
import { RoomManager } from "../core/RoomManager";
import { GuildService } from "../guilds/GuildService";

const guilds = new GuildService();

export async function who(
  sessions: SessionManager
): Promise<string> {
  const lines: string[] = [];

  for (const s of sessions.getAllSessions()) {
    const char = s.character;
    if (!char) continue;

    const g = char.guildId
      ? await guilds.getGuildForCharacter(char.id)
      : null;

    lines.push(
      `- ${char.name} (${char.classId} ${char.level})` +
      (g ? ` <${g.tag}>` : "")
    );
  }

  return lines.length ? lines.join("\n") : "No one is online.";
}

export async function nearby(
  sessions: SessionManager,
  regionId: string | null
): Promise<string> {
  if (!regionId) return "You are nowhere.";

  const lines: string[] = [];

  for (const s of sessions.getAllSessions()) {
    const char = s.character;
    if (!char || char.lastRegionId !== regionId) continue;

    const g = char.guildId
      ? await guilds.getGuildForCharacter(char.id)
      : null;

    lines.push(
      `- ${char.name} (${char.classId} ${char.level})` +
      (g ? ` <${g.tag}>` : "")
    );
  }

  return lines.length ? lines.join("\n") : "No one is nearby.";
}
