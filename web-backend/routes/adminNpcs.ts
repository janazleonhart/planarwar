//web-backend/routes/adminNpcs.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";
import { PostgresNpcService } from "../../worldcore/npc/PostgresNpcService";
import { setNpcPrototypes } from "../../worldcore/npc/NpcTypes";

const router = Router();
const npcService = new PostgresNpcService();

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
  loot: {
    itemId: string;
    chance: number;
    minQty: number;
    maxQty: number;
  }[];
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
    const payload: AdminNpcPayload[] = protos.map((p) => ({
      id: p.id,
      name: p.name,
      level: p.level,
      maxHp: p.maxHp,
      dmgMin: p.baseDamageMin,
      dmgMax: p.baseDamageMax,
      model: p.model,
      tagsText: (p.tags ?? []).join(", "),
      xpReward: p.xpReward ?? 0,
      loot:
        p.loot?.map((l) => ({
          itemId: l.itemId,
          chance: l.chance,
          minQty: l.minQty,
          maxQty: l.maxQty,
        })) ?? [],
    }));
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

    // Validate that all loot itemIds exist in the items table
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
