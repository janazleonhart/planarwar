//backend/src/routes/warfront.ts

import { Router } from "express";
import {
  DEMO_PLAYER_ID,
  getPlayerState,
  startWarfrontAssaultForPlayer,
} from "../gameState";

const router = Router();

// Stage an assault on a specific region warfront
router.post("/assault", (req, res) => {
  const { regionId } = req.body as { regionId?: string };

  if (!regionId) {
    return res.status(400).json({ error: "regionId is required" });
  }

  const now = new Date();
  const result = startWarfrontAssaultForPlayer(
    DEMO_PLAYER_ID,
    regionId as any,
    now
  );

  if (result.status !== "ok" || !result.activeMission) {
    return res.status(400).json({
      error: result.message ?? "Unable to stage warfront assault.",
      status: result.status,
    });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    activeMission: result.activeMission,
    activeMissions: ps.activeMissions,
    heroes: ps.heroes,
    armies: ps.armies,
    resources: ps.resources,
    regionWar: ps.regionWar,
  });
});

export default router;
