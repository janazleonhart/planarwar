//backend/src/routes/armies.ts

import { Router } from "express";
import {
  DEMO_PLAYER_ID,
  getPlayerState,
  raiseArmyForPlayer,
  reinforceArmyForPlayer,
} from "../gameState";
import type { ArmyType } from "../domain/armies";

const router = Router();

// Raise a new army of a given type
router.post("/raise", (req, res) => {
  const { type } = req.body as { type?: ArmyType };

  if (!type) {
    return res.status(400).json({ error: "type is required" });
  }

  const now = new Date();
  const result = raiseArmyForPlayer(DEMO_PLAYER_ID, type, now);

  if (result.status !== "ok" || !result.army) {
    return res.status(400).json({
      error: result.message ?? "Unable to raise army.",
      status: result.status,
    });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    army: result.army,
    armies: ps.armies,
    resources: ps.resources,
  });
});

// Reinforce an existing idle army
router.post("/reinforce", (req, res) => {
  const { armyId } = req.body as { armyId?: string };

  if (!armyId) {
    return res.status(400).json({ error: "armyId is required" });
  }

  const now = new Date();
  const result = reinforceArmyForPlayer(DEMO_PLAYER_ID, armyId, now);

  if (result.status !== "ok" || !result.army) {
    return res.status(400).json({
      error: result.message ?? "Unable to reinforce army.",
      status: result.status,
    });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    army: result.army,
    armies: ps.armies,
    resources: ps.resources,
  });
});

export default router;
