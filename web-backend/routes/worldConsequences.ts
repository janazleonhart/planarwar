//web-backend/routes/worldConsequences.ts

import { Router } from "express";
import { summarizePlayerWorldConsequences } from "../gameState";
import { resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.get("/status", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json({ ok: true, summary: null, ledger: [] });
  }

  return res.json({
    ok: true,
    summary: summarizePlayerWorldConsequences(access.access.playerState),
    ledger: access.access.playerState.worldConsequences ?? [],
  });
});

export default router;
