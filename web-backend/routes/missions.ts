//web-backend/routes/missions.ts

import { Router } from "express";
import {
  completeMissionForPlayer,
  getPlayerState,
  regenerateRegionMissionsForPlayer,
  startMissionForPlayer,
  tickPlayerState,
} from "../gameState";
import { persistPlayerStateForCity, resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.get("/offers", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const ps = access.access.playerState;
  const now = new Date();
  tickPlayerState(ps, now);
  if (!ps.currentOffers || ps.currentOffers.length === 0) {
    regenerateRegionMissionsForPlayer(access.access.playerId, ps.city.regionId as any, now);
  }

  await persistPlayerStateForCity(access.access);
  res.json({ missions: ps.currentOffers, activeMissions: ps.activeMissions });
});

router.post("/start", async (req, res) => {
  const { missionId } = req.body as { missionId?: string };
  if (!missionId) return res.status(400).json({ error: "missionId is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const now = new Date();
  const active = startMissionForPlayer(access.access.playerId, missionId, now);
  if (!active) return res.status(400).json({ error: "Mission not found or no available forces." });

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  await persistPlayerStateForCity({ ...access.access, playerState: ps });
  res.json({
    ok: true,
    activeMission: active,
    activeMissions: ps.activeMissions,
    heroes: ps.heroes,
    armies: ps.armies,
  });
});

router.post("/complete", async (req, res) => {
  const { instanceId } = req.body as { instanceId?: string };
  if (!instanceId) return res.status(400).json({ error: "instanceId is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const now = new Date();
  const result = completeMissionForPlayer(access.access.playerId, instanceId, now);
  if (result.status !== "ok") {
    return res.status(400).json({ error: result.message ?? "Unable to complete mission", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  await persistPlayerStateForCity({ ...access.access, playerState: ps });
  res.json({ ok: true, result, activeMissions: ps.activeMissions, heroes: ps.heroes, armies: ps.armies, resources: ps.resources, regionWar: ps.regionWar });
});

router.post("/refresh_region", async (req, res) => {
  try {
    const { regionId } = req.body as { regionId?: string };
    if (!regionId) return res.status(400).json({ error: "regionId is required" });

    const access = await resolvePlayerAccess(req, { requireCity: true });
    if (access.ok === false) return res.status(access.status).json({ error: access.error });

    const offers = regenerateRegionMissionsForPlayer(access.access.playerId, regionId as any, new Date());
    if (!offers) return res.status(404).json({ error: "Player not found" });

    await persistPlayerStateForCity(access.access);
    return res.json({ ok: true, regionId, offers });
  } catch (err) {
    console.error("refresh_region error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
