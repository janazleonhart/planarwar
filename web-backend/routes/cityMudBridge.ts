//web-backend/routes/cityMudBridge.ts

import { Router } from "express";
import { summarizeCityMudBridge } from "../domain/cityMudBridge";
import { resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.get("/status", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) {
    return res.json({ ok: true, summary: null });
  }

  return res.json({
    ok: true,
    summary: summarizeCityMudBridge(access.access.playerState),
  });
});

export default router;
