//worldcore/guilds/GuildService.ts

import { db } from "../db/Database";

export class GuildService {
  async getGuildForCharacter(charId: string) {
    const r = await db.query(
      `
      SELECT g.id, g.name, g.tag, gm.rank
      FROM guild_members gm
      JOIN guilds g ON g.id = gm.guild_id
      WHERE gm.character_id = $1
      `,
      [charId]
    );
    return r.rows[0] ?? null;
  }

  async listMembers(guildId: string) {
    const r = await db.query(
      `
      SELECT c.name, c.level, c.class_id, gm.rank
      FROM guild_members gm
      JOIN characters c ON c.id = gm.character_id
      WHERE gm.guild_id = $1
      ORDER BY c.name
      `,
      [guildId]
    );
    return r.rows;
  }
}
