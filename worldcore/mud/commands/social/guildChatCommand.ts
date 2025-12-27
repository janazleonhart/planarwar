//worldcore/mud/commands/social/guildChatCommand.ts

export async function handleGuildChatCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[] }
): Promise<string | null> {
  const messageRaw = input.args.join(" ").trim();
  if (!messageRaw) return null;

  const message = String(messageRaw).slice(0, 512);

  if (!ctx.guilds) {
    ctx.sessions.send(ctx.session, "mud_result", { text: "Guild service unavailable." });
    return null;
  }

  const guild = await ctx.guilds.getGuildForCharacter(char.id);
  if (!guild) {
    ctx.sessions.send(ctx.session, "mud_result", { text: "You are not in a guild." });
    return null;
  }

  // hydrate cache (important)
  char.guildId = guild.id;

  const now = Date.now();
  const from = `${char.name} <${guild.tag}>`;

  // v1: brute-force broadcast to matching sessions
  for (const s of ctx.sessions.getAllSessions()) {
    if (s.character?.guildId === guild.id) {
      ctx.sessions.send(s, "chat", { from, sessionId: ctx.session.id, text: message, t: now });
    }
  }

  return null;
}
