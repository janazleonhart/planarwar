// web-backend/routes/adminQuests.ts

import { Router } from "express";
import { PostgresQuestService } from "../../worldcore/quests/PostgresQuestService";

import { listAdminQuests } from "./adminQuests/adminQuestList";
import type { AdminQuestPayload } from "./adminQuests/adminQuestTypes";
import { normalizeAdminQuestPayload, upsertAdminQuest, validateAdminQuestUpsert } from "./adminQuests/adminQuestUpsert";

const router = Router();
const questService = new PostgresQuestService();

// GET /api/admin/quests  -> list quests in DB (simple view)
router.get("/", async (_req, res) => {
  try {
    const quests = await listAdminQuests(questService);
    res.json({ ok: true, quests });
  } catch (err) {
    console.error("[ADMIN/QUESTS] list error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// POST /api/admin/quests  -> upsert one quest (overwrites objectives/rewards)
router.post("/", async (req, res) => {
  const normalized = normalizeAdminQuestPayload(req.body as Partial<AdminQuestPayload>);
  if ("status" in normalized) {
    return res.status(normalized.status).json({ ok: false, error: normalized.error });
  }

  const validationError = await validateAdminQuestUpsert(normalized);
  if (validationError) {
    return res.status(validationError.status).json({ ok: false, error: validationError.error });
  }

  try {
    await upsertAdminQuest(normalized, questService);
    res.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN/QUESTS] upsert error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
