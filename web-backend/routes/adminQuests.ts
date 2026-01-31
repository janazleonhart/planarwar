//web-backend/routes/adminQuests.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";
import { PostgresQuestService } from "../../worldcore/quests/PostgresQuestService";

const router = Router();
const questService = new PostgresQuestService();

// Shape used by the web editor (v0: one objective + xp/gold)
type ObjectiveKind = "kill" | "harvest" | "collect_item" | "craft" | "talk_to" | "city";

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
};

// GET /api/admin/quests  -> list quests in DB (simple view)
router.get("/", async (_req, res) => {
  try {
    const defs = await questService.listQuests();

    // Normalize objective kind (DB stores item turn-ins as 'item_turnin' but the editor uses 'collect_item').
    const payload: AdminQuestPayload[] = defs.map((q) => {
      const firstObj = q.objectives[0];
      const rawKind = (firstObj?.kind as any) ?? "kill";
      const objectiveKind: ObjectiveKind =
        rawKind === "item_turnin" ? "collect_item" : (rawKind as ObjectiveKind);

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

      return {
        id: q.id,
        name: q.name,
        description: q.description,
        repeatable: !!q.repeatable,
        maxCompletions: q.maxCompletions ?? null,
        objectiveKind,
        objectiveTargetId: targetId,
        objectiveRequired: required,
        rewardXp: reward.xp ?? 0,
        rewardGold: reward.gold ?? 0,
      };
    });

    // Best-effort item label lookup for collect_item objectives.
    const itemIds = Array.from(
      new Set(
        payload
          .filter((q) => q.objectiveKind === "collect_item" && !!q.objectiveTargetId)
          .map((q) => q.objectiveTargetId)
      )
    );

    if (itemIds.length) {
      try {
        const r = await db.query(
          `SELECT id, name, rarity FROM items WHERE id = ANY($1::text[])`,
          [itemIds]
        );

        const map = new Map<string, { name: string; rarity: string }>();
        for (const row of r.rows as any[]) {
          map.set(String(row.id), {
            name: String(row.name ?? ""),
            rarity: String(row.rarity ?? ""),
          });
        }

        for (const q of payload) {
          if (q.objectiveKind !== "collect_item") continue;
          const hit = map.get(q.objectiveTargetId);
          if (hit) {
            q.objectiveTargetName = hit.name;
            q.objectiveTargetRarity = hit.rarity;
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ADMIN/QUESTS] item label lookup skipped due to DB error", err);
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

  if (
    !body.id ||
    !body.name ||
    !body.description ||
    !body.objectiveKind ||
    !body.objectiveTargetId
  ) {
    return res.status(400).json({
      ok: false,
      error:
        "id, name, description, objectiveKind, objectiveTargetId are required",
    });
  }

  const repeatable = !!body.repeatable;
  const maxCompletions =
    body.maxCompletions === null || body.maxCompletions === undefined
      ? null
      : Number(body.maxCompletions);

  const required = Number(body.objectiveRequired || 1);
  const rewardXp = Number(body.rewardXp || 0);
  const rewardGold = Number(body.rewardGold || 0);

  const kind = body.objectiveKind as ObjectiveKind;

  // Map editor kind -> DB enum value
  const dbKind = kind === "collect_item" ? "item_turnin" : kind;

  // Validation (best-effort, don’t brick the editor on unknown content tables)
  try {
    if (kind === "kill" || kind === "talk_to") {
      const npcCheck = await db.query("SELECT 1 FROM npcs WHERE id = $1", [
        body.objectiveTargetId,
      ]);
      if (npcCheck.rowCount === 0) {
        return res.status(400).json({
          ok: false,
          error: `NPC '${body.objectiveTargetId}' does not exist. Create it first in the NPC editor.`,
        });
      }
    }

    if (kind === "collect_item") {
      const itemCheck = await db.query("SELECT 1 FROM items WHERE id = $1", [
        body.objectiveTargetId,
      ]);
      if (itemCheck.rowCount === 0) {
        return res.status(400).json({
          ok: false,
          error: `Item '${body.objectiveTargetId}' does not exist. Create it first in the item editor.`,
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

    // 4) Insert rewards (xp + gold only for v0)
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
