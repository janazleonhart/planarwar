//backend/src/routes/tech.ts

import { Router } from "express";
import { DEMO_PLAYER_ID, startResearchForPlayer } from "../gameState";

const router = Router();

router.post("/start", (req, res) => {
  const { techId } = req.body as { techId?: string };
  if (!techId) {
    return res.status(400).json({ error: "techId is required" });
  }

  const now = new Date();
  const result = startResearchForPlayer(DEMO_PLAYER_ID, techId, now);

  if (result.status !== "ok") {
    return res.status(400).json({
      error: result.message ?? result.status,
      status: result.status,
    });
  }

  return res.json({
    status: "ok",
    research: result.research,
  });
});

export default router;
