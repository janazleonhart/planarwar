//web-backend/routes/buildings.ts

import { Router } from "express";
import { buildBuildingForPlayer, getPlayerState, upgradeBuildingForPlayer } from "../gameState";
import type { BuildingKind } from "../gameState";
import { resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.post("/construct", async (req, res) => {
  const { kind } = req.body as { kind?: BuildingKind };
  if (!kind) return res.status(400).json({ error: "kind is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const now = new Date();
  const result = buildBuildingForPlayer(access.access.playerId, kind, now);
  if (result.status !== "ok" || !result.building) {
    return res.status(400).json({ error: result.message ?? "Unable to construct building.", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  res.json({ ok: true, building: result.building, city: ps.city, resources: ps.resources });
});

router.post("/upgrade", async (req, res) => {
  const { buildingId } = req.body as { buildingId?: string };
  if (!buildingId) return res.status(400).json({ error: "buildingId is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const now = new Date();
  const result = upgradeBuildingForPlayer(access.access.playerId, buildingId, now);
  if (result.status !== "ok" || !result.building) {
    return res.status(400).json({ error: result.message ?? "Unable to upgrade building.", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  res.json({ ok: true, building: result.building, city: ps.city, resources: ps.resources });
});

export default router;
