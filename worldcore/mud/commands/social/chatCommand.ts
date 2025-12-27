// worldcore/mud/commands/social/chatCommand.ts

function getAllSessions(ctx: any): any[] {
    if (ctx.sessions?.getAllSessions) return Array.from(ctx.sessions.getAllSessions());
    if (ctx.sessions?.values) return Array.from(ctx.sessions.values());
    return [];
  }
  
  function normName(s: string): string {
    return s.trim().toLowerCase();
  }
  
  function clipText(s: string): string {
    return String(s ?? "").slice(0, 512);
  }
  
  export async function handleSayCommand(
    ctx: any,
    char: any,
    input: { cmd: string; args: string[]; parts: string[] }
  ): Promise<string | null> {
    const raw = input.args.join(" ").trim();
    if (!raw) return "Usage: say <message>";
  
    const roomId = ctx.session.roomId;
    if (!roomId) return "You are not in a room.";
  
    const text = clipText(raw);
    const now = Date.now();
  
    // Prefer the same pipeline as MessageRouter "chat"
    const room = ctx.rooms?.get?.(roomId);
    if (room?.broadcast) {
      room.broadcast("chat", {
        from: char.name,
        sessionId: ctx.session.id,
        text,
        t: now,
        kind: "say",
        roomId,
      });
      return null;
    }
  
    // Fallback if rooms isn't available
    for (const s of getAllSessions(ctx)) {
      if (s.roomId !== roomId) continue;
      ctx.sessions.send(s, "chat", {
        from: char.name,
        sessionId: ctx.session.id,
        text,
        t: now,
        kind: "say",
        roomId,
      });
    }
  
    return null;
  }
  
  export async function handleTellCommand(
    ctx: any,
    char: any,
    input: { cmd: string; args: string[]; parts: string[] }
  ): Promise<string | null> {
    if (input.args.length < 2) return "Usage: tell <player> <message>";
  
    const targetRaw = input.args[0];
    const rawMsg = input.args.slice(1).join(" ").trim();
    if (!rawMsg) return "Usage: tell <player> <message>";
  
    const needle = normName(targetRaw);
    const all = getAllSessions(ctx);
  
    const target = all.find((s) => {
      const c = s.character;
      return c?.name && normName(c.name) === needle;
    });
  
    if (!target) return `Player '${targetRaw}' is not online.`;
  
    const now = Date.now();
    const toName = target.character?.name ?? targetRaw;
    const text = clipText(rawMsg);
  
    // recipient
    ctx.sessions.send(target, "chat", {
      from: `${char.name} (tell)`,
      sessionId: ctx.session.id,
      text,
      t: now,
      kind: "tell",
      to: toName,
    });
  
    // echo back
    ctx.sessions.send(ctx.session, "chat", {
      from: `To ${toName}`,
      sessionId: ctx.session.id,
      text,
      t: now,
      kind: "tell",
      to: toName,
    });
  
    return null;
  }
  