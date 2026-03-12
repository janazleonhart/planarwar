//web-backend/routes/buildings.ts

import { Router } from "express";
import { buildBuildingForPlayer, upgradeBuildingForPlayer } from "../gameState";
import type { BuildingKind } from "../gameState";
import { withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

router.post("/construct", async (req, res) => {
  const { kind } = req.body as { kind?: BuildingKind };
  if (!kind) return res.status(400).json({ error: "kind is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const now = new Date();
    const result = buildBuildingForPlayer(access.playerId, kind, now);
    if (result.status !== "ok" || !result.building) {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to construct building.", status: result.status } };
    }

    return {
      ok: true as const,
      body: { ok: true, building: result.building, city: access.playerState.city, resources: access.playerState.resources },
    };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

router.post("/upgrade", async (req, res) => {
  const { buildingId } = req.body as { buildingId?: string };
  if (!buildingId) return res.status(400).json({ error: "buildingId is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const now = new Date();
    const result = upgradeBuildingForPlayer(access.playerId, buildingId, now);
    if (result.status !== "ok" || !result.building) {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to upgrade building.", status: result.status } };
    }

    return {
      ok: true as const,
      body: { ok: true, building: result.building, city: access.playerState.city, resources: access.playerState.resources },
    };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

export default router;
