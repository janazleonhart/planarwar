//web-backend/routes/armies.ts

import { Router } from "express";
import { getPlayerState, raiseArmyForPlayer, reinforceArmyForPlayer } from "../gameState";
import type { ArmyType } from "../domain/armies";
import { resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.post("/raise", async (req, res) => {
  const { type } = req.body as { type?: ArmyType };
  if (!type) return res.status(400).json({ error: "type is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const now = new Date();
  const result = raiseArmyForPlayer(access.access.playerId, type, now);
  if (result.status !== "ok" || !result.army) {
    return res.status(400).json({ error: result.message ?? "Unable to raise army.", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  res.json({ ok: true, army: result.army, armies: ps.armies, resources: ps.resources });
});

router.post("/reinforce", async (req, res) => {
  const { armyId } = req.body as { armyId?: string };
  if (!armyId) return res.status(400).json({ error: "armyId is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const now = new Date();
  const result = reinforceArmyForPlayer(access.access.playerId, armyId, now);
  if (result.status !== "ok" || !result.army) {
    return res.status(400).json({ error: result.message ?? "Unable to reinforce army.", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  res.json({ ok: true, army: result.army, armies: ps.armies, resources: ps.resources });
});

export default router;
