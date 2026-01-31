//web-backend/routes/adminNpcs.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";
import { PostgresNpcService } from "../../worldcore/npc/PostgresNpcService";
import { setNpcPrototypes } from "../../worldcore/npc/NpcTypes";

const router = Router();
const npcService = new PostgresNpcService();

type AdminNpcLootRow = {
  itemId: string;
  chance: number;
  minQty: number;
  maxQty: number;
  // Enriched display (optional)
  itemName?: string;
  itemRarity?: string;
};

type AdminNpcPayload = {
  id: string;
  name: string;
  level: number;
  maxHp: number;
  dmgMin: number;
  dmgMax: number;
  model?: string;
  tagsText?: string; // comma-separated from UI
  tags?: string[]; // optional future-friendly form
  xpReward: number;
  loot: AdminNpcLootRow[];
};

function normTag(t: string): string {
  return String(t ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function parseTags(tagsText?: string): string[] {
  const raw = String(tagsText ?? "");
  const parts = raw
    .split(",")
    .map((s) => normTag(s))
    .filter(Boolean);

  // dedupe preserving order
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of parts) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function normalizeTags(tags: unknown, tagsText?: string): string[] {
  if (Array.isArray(tags)) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of tags) {
      const n = normTag(String(t));
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }
  return parseTags(tagsText);
}

router.get("/", async (_req, res) => {
  try {
    const protos = await npcService.listNpcs();

    // Enrich loot rows with item names, so editors can show human labels.
    const lootItemIds: string[] = [];
    for (const p of protos) {
      for (const l of p.loot ?? []) {
        if (l?.itemId) lootItemIds.push(String(l.itemId));
      }
    }
    const uniqueItemIds = Array.from(new Set(lootItemIds)).filter(Boolean);

    const itemMeta = new Map<string, { name: string; rarity: string }>();
    if (uniqueItemIds.length) {
      const r = await db.query(
        `SELECT id, name, rarity FROM items WHERE id = ANY($1::text[])`,
        [uniqueItemIds]
      );
      for (const row of r.rows ?? []) {
        itemMeta.set(String(row.id), {
          name: String(row.name ?? ""),
          rarity: String(row.rarity ?? ""),
        });
      }
    }

    const payload: AdminNpcPayload[] = protos.map((p) => {
      const tagsText = (p.tags ?? []).join(", ");
      const loot: AdminNpcLootRow[] =
        p.loot?.map((l) => {
          const m = itemMeta.get(l.itemId);
          return {
            itemId: l.itemId,
            chance: l.chance,
            minQty: l.minQty,
            maxQty: l.maxQty,
            itemName: m?.name,
            itemRarity: m?.rarity,
          };
        }) ?? [];

      return {
        id: p.id,
        name: p.name,
        level: p.level,
        maxHp: p.maxHp,
        dmgMin: p.baseDamageMin,
        dmgMax: p.baseDamageMax,
        model: p.model,
        tagsText,
        xpReward: p.xpReward ?? 0,
        loot,
      };
    });

    res.json({ ok: true, npcs: payload });
  } catch (err) {
    console.error("[ADMIN/NPCS] list error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/", async (req, res) => {
  const body = req.body as AdminNpcPayload;

  if (!body.id || !body.name) {
    return res.status(400).json({
      ok: false,
      error: "id and name are required",
    });
  }

  const tags = normalizeTags(body.tags, body.tagsText);

  try {
    // Validate that all loot itemIds exist in the items table (typo protection).
    for (const row of body.loot ?? []) {
      if (!row.itemId) continue;

      const itemCheck = await db.query("SELECT 1 FROM items WHERE id = $1", [row.itemId]);
      if (itemCheck.rowCount === 0) {
        return res.status(400).json({
          ok: false,
          error: `Item '${row.itemId}' does not exist. Create it first in the item editor / items table.`,
        });
      }
    }

    // upsert npc
    await db.query(
      `
      INSERT INTO npcs (id, name, level, max_hp, dmg_min, dmg_max, model, tags, xp_reward)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        level = EXCLUDED.level,
        max_hp = EXCLUDED.max_hp,
        dmg_min = EXCLUDED.dmg_min,
        dmg_max = EXCLUDED.dmg_max,
        model = EXCLUDED.model,
        tags = EXCLUDED.tags,
        xp_reward = EXCLUDED.xp_reward,
        updated_at = NOW()
      `,
      [
        body.id,
        body.name,
        body.level ?? 1,
        body.maxHp ?? 1,
        body.dmgMin ?? 0,
        body.dmgMax ?? 0,
        body.model ?? null,
        tags,
        body.xpReward ?? 0,
      ]
    );

    // wipe & rewrite loot
    await db.query("DELETE FROM npc_loot WHERE npc_id = $1", [body.id]);

    for (let i = 0; i < (body.loot ?? []).length; i++) {
      const row = body.loot[i];
      if (!row.itemId) continue;
      await db.query(
        `
        INSERT INTO npc_loot (npc_id, idx, item_id, chance, min_qty, max_qty)
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          body.id,
          i,
          row.itemId,
          row.chance ?? 1,
          row.minQty ?? 1,
          row.maxQty ?? row.minQty ?? 1,
        ]
      );
    }

    // reload prototypes into MMO server
    const protos = await npcService.listNpcs();
    setNpcPrototypes(protos);

    res.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN/NPCS] upsert error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
