// web-backend/routes/adminQuests.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";
import { PostgresQuestService } from "../../worldcore/quests/PostgresQuestService";

const router = Router();
const questService = new PostgresQuestService();

// Shape used by the web editor (v0: one objective + xp/gold + item rewards + spell/ability grant rewards)
type ObjectiveKind = "kill" | "harvest" | "collect_item" | "craft" | "talk_to" | "city";

type AdminRewardItem = {
  itemId: string;
  count: number;

  // Best-effort display helpers (computed on GET)
  itemName?: string;
  itemRarity?: string;
};

type AdminRewardSpellGrant = {
  spellId: string;
  source?: string;

  // Best-effort display helpers (computed on GET)
  spellName?: string;
};

type AdminRewardAbilityGrant = {
  abilityId: string;
  source?: string;

  // Best-effort display helpers (computed on GET)
  abilityName?: string;
};

type AdminQuestPayload = {
  id: string;
  name: string;
  description: string;
  repeatable?: boolean;
  maxCompletions?: number | null;

  objectiveKind: ObjectiveKind;
  objectiveTargetId: string;
  objectiveRequired: number;

  // Best-effort display helpers (computed on GET)
  objectiveTargetName?: string;
  objectiveTargetRarity?: string;

  rewardXp?: number;
  rewardGold?: number;
  rewardItems?: AdminRewardItem[];

  // Rank grants / quest reward grants
  rewardSpellGrants?: AdminRewardSpellGrant[];
  rewardAbilityGrants?: AdminRewardAbilityGrant[];
};

// GET /api/admin/quests  -> list quests in DB (simple view)
router.get("/", async (_req, res) => {
  try {
    const defs = await questService.listQuests();

    const payload: AdminQuestPayload[] = defs.map((q) => {
      const firstObj = q.objectives[0];
      const rawKind = (firstObj?.kind as any) ?? "kill";
      const objectiveKind: ObjectiveKind = rawKind === "item_turnin" ? "collect_item" : (rawKind as ObjectiveKind);

      const targetId =
        (firstObj as any)?.targetProtoId ??
        (firstObj as any)?.nodeProtoId ??
        (firstObj as any)?.itemId ??
        (firstObj as any)?.actionId ??
        (firstObj as any)?.cityActionId ??
        (firstObj as any)?.npcId ??
        "";

      const required = (firstObj as any)?.required ?? 1;
      const reward = q.reward || {};

      const rewardItems: AdminRewardItem[] = Array.isArray((reward as any).items)
        ? ((reward as any).items as any[]).map((it) => ({
            itemId: String(it?.itemId ?? ""),
            count: Number(it?.count ?? 1),
          }))
        : [];

      const rewardSpellGrants: AdminRewardSpellGrant[] = Array.isArray((reward as any).spellGrants)
        ? ((reward as any).spellGrants as any[]).map((g) => ({
            spellId: String(g?.spellId ?? ""),
            source: g?.source ? String(g.source) : undefined,
          }))
        : [];

      const rewardAbilityGrants: AdminRewardAbilityGrant[] = Array.isArray((reward as any).abilityGrants)
        ? ((reward as any).abilityGrants as any[]).map((g) => ({
            abilityId: String(g?.abilityId ?? ""),
            source: g?.source ? String(g.source) : undefined,
          }))
        : [];

      return {
        id: q.id,
        name: q.name,
        description: q.description,
        repeatable: !!q.repeatable,
        maxCompletions: q.maxCompletions ?? null,
        objectiveKind,
        objectiveTargetId: targetId,
        objectiveRequired: required,
        rewardXp: (reward as any).xp ?? 0,
        rewardGold: (reward as any).gold ?? 0,
        rewardItems,
        rewardSpellGrants,
        rewardAbilityGrants,
      };
    });

    // Best-effort item label lookup for collect_item objectives + reward items.
    const objectiveItemIds = payload
      .filter((q) => q.objectiveKind === "collect_item" && !!q.objectiveTargetId)
      .map((q) => q.objectiveTargetId);

    const rewardItemIds = payload
      .flatMap((q) => q.rewardItems ?? [])
      .map((it) => it.itemId)
      .filter(Boolean);

    const itemIds = Array.from(new Set([...objectiveItemIds, ...rewardItemIds].map((x) => String(x)).filter(Boolean)));

    if (itemIds.length) {
      try {
        const r = await db.query(`SELECT id, name, rarity FROM items WHERE id = ANY($1::text[])`, [itemIds]);

        const map = new Map<string, { name: string; rarity: string }>();
        for (const row of r.rows as any[]) {
          map.set(String(row.id), {
            name: String(row.name ?? ""),
            rarity: String(row.rarity ?? ""),
          });
        }

        for (const q of payload) {
          if (q.objectiveKind === "collect_item") {
            const hit = map.get(q.objectiveTargetId);
            if (hit) {
              q.objectiveTargetName = hit.name;
              q.objectiveTargetRarity = hit.rarity;
            }
          }

          for (const it of q.rewardItems ?? []) {
            const hit = map.get(it.itemId);
            if (hit) {
              it.itemName = hit.name;
              it.itemRarity = hit.rarity;
            }
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ADMIN/QUESTS] item label lookup skipped due to DB error", err);
      }
    }

    // Best-effort spell/ability label lookup for grant rewards.
    const spellIds = Array.from(
      new Set(
        payload
          .flatMap((q) => q.rewardSpellGrants ?? [])
          .map((g) => (g.spellId || "").trim())
          .filter(Boolean)
      )
    );

    const abilityIds = Array.from(
      new Set(
        payload
          .flatMap((q) => q.rewardAbilityGrants ?? [])
          .map((g) => (g.abilityId || "").trim())
          .filter(Boolean)
      )
    );

    if (spellIds.length) {
      try {
        const r = await db.query(`SELECT id, name FROM spells WHERE id = ANY($1::text[])`, [spellIds]);
        const map = new Map<string, string>();
        for (const row of r.rows as any[]) {
          map.set(String(row.id), String(row.name ?? ""));
        }
        for (const q of payload) {
          for (const g of q.rewardSpellGrants ?? []) {
            const hit = map.get((g.spellId || "").trim());
            if (hit) g.spellName = hit;
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ADMIN/QUESTS] spell label lookup skipped due to DB error", err);
      }
    }

    if (abilityIds.length) {
      try {
        const r = await db.query(`SELECT id, name FROM abilities WHERE id = ANY($1::text[])`, [abilityIds]);
        const map = new Map<string, string>();
        for (const row of r.rows as any[]) {
          map.set(String(row.id), String(row.name ?? ""));
        }
        for (const q of payload) {
          for (const g of q.rewardAbilityGrants ?? []) {
            const hit = map.get((g.abilityId || "").trim());
            if (hit) g.abilityName = hit;
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ADMIN/QUESTS] ability label lookup skipped due to DB error", err);
      }
    }

    res.json({ ok: true, quests: payload });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN/QUESTS] list error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// POST /api/admin/quests  -> upsert one quest (overwrites objectives/rewards)
router.post("/", async (req, res) => {
  const body = req.body as Partial<AdminQuestPayload>;

  if (!body.id || !body.name || !body.description || !body.objectiveKind || !body.objectiveTargetId) {
    return res.status(400).json({
      ok: false,
      error: "id, name, description, objectiveKind, objectiveTargetId are required",
    });
  }

  const repeatable = !!body.repeatable;
  const maxCompletions = body.maxCompletions === null || body.maxCompletions === undefined ? null : Number(body.maxCompletions);

  const required = Number(body.objectiveRequired || 1);
  const rewardXp = Number(body.rewardXp || 0);
  const rewardGold = Number(body.rewardGold || 0);

  const rewardItemsRaw = Array.isArray(body.rewardItems) ? body.rewardItems : [];
  const rewardItems: { itemId: string; count: number }[] = rewardItemsRaw
    .map((it) => ({
      itemId: String((it as any)?.itemId ?? "").trim(),
      count: Number((it as any)?.count ?? 1),
    }))
    .filter((it) => !!it.itemId);

  const rewardSpellGrantsRaw = Array.isArray(body.rewardSpellGrants) ? body.rewardSpellGrants : [];
  const rewardSpellGrants: { spellId: string; source?: string }[] = rewardSpellGrantsRaw
    .map((g) => ({
      spellId: String((g as any)?.spellId ?? "").trim(),
      source: (g as any)?.source ? String((g as any).source).trim() : undefined,
    }))
    .filter((g) => !!g.spellId);

  const rewardAbilityGrantsRaw = Array.isArray(body.rewardAbilityGrants) ? body.rewardAbilityGrants : [];
  const rewardAbilityGrants: { abilityId: string; source?: string }[] = rewardAbilityGrantsRaw
    .map((g) => ({
      abilityId: String((g as any)?.abilityId ?? "").trim(),
      source: (g as any)?.source ? String((g as any).source).trim() : undefined,
    }))
    .filter((g) => !!g.abilityId);

  const kind = body.objectiveKind as ObjectiveKind;

  // Map editor kind -> DB enum value (historical reasons)
  const dbKind = kind === "collect_item" ? "item_turnin" : kind;

  // Validation (best-effort, don’t brick the editor on unknown content tables)
  try {
    if (kind === "kill" || kind === "talk_to") {
      const npcCheck = await db.query("SELECT 1 FROM npcs WHERE id = $1", [body.objectiveTargetId]);
      if (npcCheck.rowCount === 0) {
        return res.status(400).json({
          ok: false,
          error: `NPC '${body.objectiveTargetId}' does not exist. Create it first in the NPC editor.`,
        });
      }
    }

    if (kind === "collect_item") {
      const itemCheck = await db.query("SELECT 1 FROM items WHERE id = $1", [body.objectiveTargetId]);
      if (itemCheck.rowCount === 0) {
        return res.status(400).json({
          ok: false,
          error: `Item '${body.objectiveTargetId}' does not exist. Create it first in the item editor.`,
        });
      }
    }

    if (rewardItems.length) {
      const ids = Array.from(new Set(rewardItems.map((x) => x.itemId)));
      const r = await db.query(`SELECT id FROM items WHERE id = ANY($1::text[])`, [ids]);
      const have = new Set((r.rows as any[]).map((row) => String(row.id)));

      const missing = ids.filter((id) => !have.has(id));
      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Reward item(s) do not exist: ${missing.join(", ")}. Create them in the item editor first.`,
        });
      }
    }

    if (rewardSpellGrants.length) {
      const ids = Array.from(new Set(rewardSpellGrants.map((g) => g.spellId)));
      const r = await db.query(`SELECT id FROM spells WHERE id = ANY($1::text[])`, [ids]);
      const have = new Set((r.rows as any[]).map((row) => String(row.id)));

      const missing = ids.filter((id) => !have.has(id));
      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Spell grant(s) reference unknown spellId: ${missing.join(", ")}. Create/seed them first.`,
        });
      }
    }

    if (rewardAbilityGrants.length) {
      const ids = Array.from(new Set(rewardAbilityGrants.map((g) => g.abilityId)));
      const r = await db.query(`SELECT id FROM abilities WHERE id = ANY($1::text[])`, [ids]);
      const have = new Set((r.rows as any[]).map((row) => String(row.id)));

      const missing = ids.filter((id) => !have.has(id));
      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Ability grant(s) reference unknown abilityId: ${missing.join(", ")}. Create/seed them first.`,
        });
      }
    }

    // harvest/craft/city: no hard validation here (table names differ per build)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ADMIN/QUESTS] validation skipped due to DB error", err);
  }

  try {
    // 1) Upsert quest row
    await db.query(
      `
      INSERT INTO quests (id, name, description, repeatable, max_repeats, is_enabled)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        repeatable = EXCLUDED.repeatable,
        max_repeats = EXCLUDED.max_repeats,
        updated_at = NOW()
      `,
      [body.id, body.name, body.description, repeatable, maxCompletions]
    );

    // 2) Clear old objectives / rewards
    await db.query("DELETE FROM quest_objectives WHERE quest_id = $1", [body.id]);
    await db.query("DELETE FROM quest_rewards WHERE quest_id = $1", [body.id]);

    // 3) Insert single objective
    await db.query(
      `
      INSERT INTO quest_objectives (quest_id, idx, kind, target_id, required, extra_json)
      VALUES ($1, 0, $2, $3, $4, '{}'::jsonb)
      `,
      [body.id, dbKind, body.objectiveTargetId, required]
    );

    // 4) Insert rewards
    if (rewardXp > 0) {
      await db.query(
        `
        INSERT INTO quest_rewards (quest_id, kind, amount, extra_json)
        VALUES ($1, 'xp', $2, '{}'::jsonb)
        `,
        [body.id, rewardXp]
      );
    }

    if (rewardGold > 0) {
      await db.query(
        `
        INSERT INTO quest_rewards (quest_id, kind, amount, extra_json)
        VALUES ($1, 'gold', $2, '{}'::jsonb)
        `,
        [body.id, rewardGold]
      );
    }

    for (const it of rewardItems) {
      const qty = Math.max(1, Number(it.count || 1));
      await db.query(
        `
        INSERT INTO quest_rewards (quest_id, kind, item_id, item_qty, extra_json)
        VALUES ($1, 'item', $2, $3, '{}'::jsonb)
        `,
        [body.id, it.itemId, qty]
      );
    }

    for (const g of rewardSpellGrants) {
      const source = (g.source || "").trim() || `quest:${body.id}`;
      await db.query(
        `
        INSERT INTO quest_rewards (quest_id, kind, extra_json)
        VALUES ($1, 'spell_grant', $2::jsonb)
        `,
        [body.id, JSON.stringify({ spellId: g.spellId, source })]
      );
    }

    for (const g of rewardAbilityGrants) {
      const source = (g.source || "").trim() || `quest:${body.id}`;
      await db.query(
        `
        INSERT INTO quest_rewards (quest_id, kind, extra_json)
        VALUES ($1, 'ability_grant', $2::jsonb)
        `,
        [body.id, JSON.stringify({ abilityId: g.abilityId, source })]
      );
    }

    // 5) Reload quest definitions into in-process registry
    const defs = await questService.listQuests();
    const { setQuestDefinitions } = await import("../../worldcore/quests/QuestRegistry");
    setQuestDefinitions(defs);

    res.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN/QUESTS] upsert error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
