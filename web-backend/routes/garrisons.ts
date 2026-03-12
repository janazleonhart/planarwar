//web-backend/routes/garrisons.ts

import { Router } from "express";
import { getPlayerState, startGarrisonStrikeForPlayer } from "../gameState";
import { persistPlayerStateForCity, resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.post("/strike", async (req, res) => {
  const { regionId } = req.body as { regionId?: string };
  if (!regionId) return res.status(400).json({ error: "regionId is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const result = startGarrisonStrikeForPlayer(access.access.playerId, regionId as any, new Date());
  if (result.status !== "ok" || !result.activeMission) {
    return res.status(400).json({ error: result.message ?? "Unable to start garrison strike.", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  await persistPlayerStateForCity({ ...access.access, playerState: ps });
  res.json({ ok: true, activeMission: result.activeMission, activeMissions: ps.activeMissions, heroes: ps.heroes, armies: ps.armies, resources: ps.resources, regionWar: ps.regionWar });
});

export default router;
