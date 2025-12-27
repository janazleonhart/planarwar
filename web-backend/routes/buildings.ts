//backend/src/routes/buildings.ts

import { Router } from "express";
import {
  DEMO_PLAYER_ID,
  getPlayerState,
  buildBuildingForPlayer,
  upgradeBuildingForPlayer,
} from "../gameState";
import type { BuildingKind } from "../gameState";

const router = Router();

// Construct a new building in the city
router.post("/construct", (req, res) => {
  const { kind } = req.body as { kind?: BuildingKind };

  if (!kind) {
    return res.status(400).json({ error: "kind is required" });
  }

  const now = new Date();
  const result = buildBuildingForPlayer(DEMO_PLAYER_ID, kind, now);

  if (result.status !== "ok" || !result.building) {
    return res.status(400).json({
      error: result.message ?? "Unable to construct building.",
      status: result.status,
    });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    building: result.building,
    city: ps.city,
    resources: ps.resources,
  });
});

// Upgrade an existing building
router.post("/upgrade", (req, res) => {
  const { buildingId } = req.body as { buildingId?: string };

  if (!buildingId) {
    return res.status(400).json({ error: "buildingId is required" });
  }

  const now = new Date();
  const result = upgradeBuildingForPlayer(
    DEMO_PLAYER_ID,
    buildingId,
    now
  );

  if (result.status !== "ok" || !result.building) {
    return res.status(400).json({
      error: result.message ?? "Unable to upgrade building.",
      status: result.status,
    });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    building: result.building,
    city: ps.city,
    resources: ps.resources,
  });
});

export default router;
