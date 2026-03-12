//web-backend/routes/garrisons.ts

import { Router } from "express";
import { startGarrisonStrikeForPlayer } from "../gameState";
import { withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

router.post("/strike", async (req, res) => {
  const { regionId } = req.body as { regionId?: string };
  if (!regionId) return res.status(400).json({ error: "regionId is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = startGarrisonStrikeForPlayer(access.playerId, regionId as any, new Date());
    if (result.status !== "ok" || !result.activeMission) {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to start garrison strike.", status: result.status } };
    }

    return { ok: true as const, body: { ok: true, activeMission: result.activeMission, activeMissions: access.playerState.activeMissions, heroes: access.playerState.heroes, armies: access.playerState.armies, resources: access.playerState.resources, regionWar: access.playerState.regionWar } };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

export default router;
