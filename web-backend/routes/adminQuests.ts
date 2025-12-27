//web-backend/routes/adminQuests.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";
import { PostgresQuestService } from "../../worldcore/quests/PostgresQuestService";

const router = Router();
const questService = new PostgresQuestService();

// Shape used by the web editor (v0: one objective + xp/gold)
type AdminQuestPayload = {
  id: string;
  name: string;
  description: string;
  repeatable?: boolean;
  maxCompletions?: number | null;

  objectiveKind: "kill" | "harvest" | "collect_item";
  objectiveTargetId: string;
  objectiveRequired: number;

  rewardXp?: number;
  rewardGold?: number;
};

// GET /api/admin/quests  -> list quests in DB (simple view)
router.get("/", async (_req, res) => {
  try {
    const defs = await questService.listQuests();

    const payload: AdminQuestPayload[] = defs.map((q) => {
      const firstObj = q.objectives[0];

      // pull the target id regardless of which field it lives on
      const targetId =
        (firstObj as any)?.targetProtoId ??
        (firstObj as any)?.nodeProtoId ??
        (firstObj as any)?.itemId ??
        "";

      const required = (firstObj as any)?.required ?? 1;

      const reward = q.reward || {};

      return {
        id: q.id,
        name: q.name,
        description: q.description,
        repeatable: !!q.repeatable,
        maxCompletions: q.maxCompletions ?? null,
        objectiveKind: (firstObj?.kind as any) ?? "kill",
        objectiveTargetId: targetId,
        objectiveRequired: required,
        rewardXp: reward.xp ?? 0,
        rewardGold: reward.gold ?? 0,
      };
    });

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

  // Map editor kind -> DB enum value
  const dbKind =
    body.objectiveKind === "collect_item"
      ? "item_turnin"
      : body.objectiveKind;

  // Validate that the target exists for this objective kind
  if (body.objectiveKind === "kill" || body.objectiveKind === "harvest") {
    const npcCheck = await db.query(
      "SELECT 1 FROM npcs WHERE id = $1",
      [body.objectiveTargetId]
    );
    if (npcCheck.rowCount === 0) {
      return res.status(400).json({
        ok: false,
        error: `NPC '${body.objectiveTargetId}' does not exist. Create it first in the NPC editor.`,
      });
    }
  }

  if (body.objectiveKind === "collect_item") {
    const itemCheck = await db.query(
      "SELECT 1 FROM items WHERE id = $1", // adjust table name to your real items table
      [body.objectiveTargetId]
    );
    if (itemCheck.rowCount === 0) {
      return res.status(400).json({
        ok: false,
        error: `Item '${body.objectiveTargetId}' does not exist. Create it first in the item editor.`,
      });
    }
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

    // (Optional but very useful for debugging once)
    // const check = await db.query("SELECT id FROM quests WHERE id = $1", [body.id]);
    // console.log("[ADMIN/QUESTS] quest row after upsert:", check.rows);

    // 2) Clear old objectives / rewards
    await db.query("DELETE FROM quest_objectives WHERE quest_id = $1", [
      body.id,
    ]);
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
    const { setQuestDefinitions } = await import(
      "../../worldcore/quests/QuestRegistry"
    );
    setQuestDefinitions(defs);

    res.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN/QUESTS] upsert error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
