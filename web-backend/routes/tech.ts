//web-backend/routes/tech.ts

import { Router } from "express";
import { startResearchForPlayer } from "../gameState";
import { withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

router.post("/start", async (req, res) => {
  const { techId } = req.body as { techId?: string };
  if (!techId) return res.status(400).json({ error: "techId is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = startResearchForPlayer(access.playerId, techId, new Date());
    if (result.status !== "ok") {
      return { ok: false as const, code: 400, body: { error: result.message ?? result.status, status: result.status } };
    }

    return { ok: true as const, body: { status: "ok", research: result.research } };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

export default router;
