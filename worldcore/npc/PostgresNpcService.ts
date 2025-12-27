// worldcore/npc/PostgresNpcService.ts

import { db } from "../db/Database";
import type { NpcPrototype, NpcLootEntry } from "./NpcTypes";

type NpcRow = {
  id: string;
  name: string;
  level: number;
  max_hp: number;
  dmg_min: number;
  dmg_max: number;
  model: string | null;
  tags: string[] | null;
  xp_reward: number;
};

type LootRow = {
  npc_id: string;
  idx: number;
  item_id: string;
  chance: number;
  min_qty: number;
  max_qty: number;
};

export class PostgresNpcService {
  async listNpcs(): Promise<NpcPrototype[]> {
    const npcRes = await db.query<NpcRow>(
      `
      SELECT id, name, level, max_hp, dmg_min, dmg_max, model, tags, xp_reward
      FROM npcs
      ORDER BY id
      `
    );

    const lootRes = await db.query<LootRow>(
      `
      SELECT npc_id, idx, item_id, chance, min_qty, max_qty
      FROM npc_loot
      ORDER BY npc_id, idx
      `
    );

    const lootMap: Record<string, NpcLootEntry[]> = {};
    for (const row of lootRes.rows) {
      (lootMap[row.npc_id] ||= []).push({
        itemId: row.item_id,
        chance: row.chance,
        minQty: row.min_qty,
        maxQty: row.max_qty,
      });
    }

    return npcRes.rows.map((row) => ({
      id: row.id,
      name: row.name,
      level: row.level,
      maxHp: row.max_hp,
      baseDamageMin: row.dmg_min,
      baseDamageMax: row.dmg_max,
      model: row.model ?? undefined,
      tags: row.tags ?? [],
      xpReward: row.xp_reward,
      loot: lootMap[row.id] ?? [],
    }));
  }
}
