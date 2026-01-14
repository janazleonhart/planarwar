// worldcore/npc/PostgresNpcService.ts

/**
 * IMPORTANT:
 * - Safe to import in unit tests.
 * - We lazy-import Database.ts to avoid opening sockets during `node --test`.
 */
function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

async function getDb(): Promise<any> {
  const mod: any = await import("../db/Database");
  return mod.db;
}

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
  /**
   * Loads all NPC prototypes (and their loot) from Postgres.
   *
   * In unit tests this MUST be inert.
   */
  async listNpcs(): Promise<NpcPrototype[]> {
    if (isNodeTestRuntime()) return [];

    const db = await getDb();

    const npcRes = await db.query(
      `
      SELECT id, name, level, max_hp, dmg_min, dmg_max, model, tags, xp_reward
      FROM npcs
      ORDER BY id
      `,
    );

    const lootRes = await db.query(
      `
      SELECT npc_id, idx, item_id, chance, min_qty, max_qty
      FROM npc_loot
      ORDER BY npc_id, idx
      `,
    );

    const npcRows = npcRes.rows as NpcRow[];
    const lootRows = lootRes.rows as LootRow[];

    const lootMap: Record<string, NpcLootEntry[]> = {};
    for (const row of lootRows) {
      (lootMap[row.npc_id] ||= []).push({
        // NOTE: NpcLootEntry does NOT include idx — ordering is by DB query ORDER BY.
        itemId: row.item_id,
        chance: row.chance,
        minQty: row.min_qty,
        maxQty: row.max_qty,
      });
    }

    return npcRows.map((row: NpcRow): NpcPrototype => ({
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
