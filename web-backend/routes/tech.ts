//web-backend/routes/tech.ts

import { Router } from "express";
import { startResearchForPlayer } from "../gameState";
import { persistPlayerStateForCity, resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.post("/start", async (req, res) => {
  const { techId } = req.body as { techId?: string };
  if (!techId) return res.status(400).json({ error: "techId is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const result = startResearchForPlayer(access.access.playerId, techId, new Date());
  if (result.status !== "ok") {
    return res.status(400).json({ error: result.message ?? result.status, status: result.status });
  }

  await persistPlayerStateForCity(access.access);
  return res.json({ status: "ok", research: result.research });
});

export default router;
