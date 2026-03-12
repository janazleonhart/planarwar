//web-backend/routes/armies.ts

import { Router } from "express";
import { raiseArmyForPlayer, reinforceArmyForPlayer } from "../gameState";
import type { ArmyType } from "../domain/armies";
import { withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

router.post("/raise", async (req, res) => {
  const { type } = req.body as { type?: ArmyType };
  if (!type) return res.status(400).json({ error: "type is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = raiseArmyForPlayer(access.playerId, type, new Date());
    if (result.status !== "ok" || !result.army) {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to raise army.", status: result.status } };
    }

    return { ok: true as const, body: { ok: true, army: result.army, armies: access.playerState.armies, resources: access.playerState.resources } };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

router.post("/reinforce", async (req, res) => {
  const { armyId } = req.body as { armyId?: string };
  if (!armyId) return res.status(400).json({ error: "armyId is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = reinforceArmyForPlayer(access.playerId, armyId, new Date());
    if (result.status !== "ok" || !result.army) {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to reinforce army.", status: result.status } };
    }

    return { ok: true as const, body: { ok: true, army: result.army, armies: access.playerState.armies, resources: access.playerState.resources } };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

export default router;
