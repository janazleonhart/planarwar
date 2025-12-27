// mud/commands/sessionLookup.ts

export function findSessionByCharacterNameInRoom(ctx: any, roomId: string | null, name: string): any | null {
    if (!roomId) return null;
    const lower = name.toLowerCase();
  
    for (const s of ctx.sessions.getAllSessions()) {
      if (!s.character) continue;
      if (s.roomId !== roomId) continue;
      if (s.character.name.toLowerCase() === lower) return s;
    }
    return null;
  }
  
  export function findSessionByCharacterId(ctx: any, charId: string): any | null {
    for (const s of ctx.sessions.getAllSessions()) {
      if (s.character && s.character.id === charId) return s;
    }
    return null;
  }
  