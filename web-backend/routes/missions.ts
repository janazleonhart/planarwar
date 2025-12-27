// backend/src/routes/missions.ts

import { Router } from "express";
import express from "express";
import {
  DEMO_PLAYER_ID,
  getPlayerState,
  getDemoPlayerWithOffers,
  startMissionForPlayer,
  completeMissionForPlayer,
  regenerateRegionMissionsForPlayer,
} from "../gameState";

const router = Router();

// Optional: list current offers + active missions
router.get("/offers", (_req, res) => {
  const ps = getDemoPlayerWithOffers();
  res.json({
    missions: ps.currentOffers,
    activeMissions: ps.activeMissions,
  });
});

// Start a mission from an offer
router.post("/start", (req, res) => {
  const { missionId } = req.body as { missionId?: string };

  if (!missionId) {
    return res.status(400).json({ error: "missionId is required" });
  }

  const now = new Date();
  const active = startMissionForPlayer(DEMO_PLAYER_ID, missionId, now);

  if (!active) {
    return res
      .status(400)
      .json({ error: "Mission not found or no available forces." });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    activeMission: {
      instanceId: active.instanceId,
      mission: active.mission,
      // already ISO strings in gameState
      startedAt: active.startedAt,
      finishesAt: active.finishesAt,
      assignedHeroId: active.assignedHeroId,
      assignedArmyId: active.assignedArmyId,
    },
    activeMissions: ps.activeMissions.map((am) => ({
      instanceId: am.instanceId,
      mission: am.mission,
      startedAt: am.startedAt,
      finishesAt: am.finishesAt,
      assignedHeroId: am.assignedHeroId,
      assignedArmyId: am.assignedArmyId,
    })),
    heroes: ps.heroes,
    armies: ps.armies,
  });
});

// Complete a mission and resolve outcome
router.post("/complete", (req, res) => {
  const { instanceId } = req.body as { instanceId?: string };

  if (!instanceId) {
    return res.status(400).json({ error: "instanceId is required" });
  }

  const now = new Date();
  const result = completeMissionForPlayer(DEMO_PLAYER_ID, instanceId, now);

  if (result.status !== "ok") {
    return res.status(400).json({
      error: result.message ?? "Unable to complete mission",
      status: result.status,
    });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    result,
    activeMissions: ps.activeMissions.map((am) => ({
      instanceId: am.instanceId,
      mission: am.mission,
      startedAt: am.startedAt,
      finishesAt: am.finishesAt,
      assignedHeroId: am.assignedHeroId,
      assignedArmyId: am.assignedArmyId,
    })),
    heroes: ps.heroes,
    armies: ps.armies,
    resources: ps.resources,
    regionWar: ps.regionWar,
  });
});

// Refresh/Get Missions From Region
router.post("/refresh_region", (req, res) => {
  try {
    const { regionId } = req.body as { regionId?: string };

    if (!regionId) {
      return res.status(400).json({ error: "regionId is required" });
    }

    const now = new Date();
    const offers = regenerateRegionMissionsForPlayer(
      DEMO_PLAYER_ID,
      regionId as any, // RegionId is a string alias
      now
    );

    if (!offers) {
      return res.status(404).json({ error: "Player not found" });
    }

    return res.json({
      ok: true,
      regionId,
      offers,
    });
  } catch (err) {
    console.error("refresh_region error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
