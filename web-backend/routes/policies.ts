//web-backend/routes/policies.ts

import { Router } from "express";
import { tickPlayerState } from "../gameState";
import { persistPlayerStateForCity, resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.get("/", async (req, res) => {
  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  tickPlayerState(access.access.playerState, new Date());
  await persistPlayerStateForCity(access.access);
  res.json({ policies: access.access.playerState.policies });
});

router.post("/toggle", async (req, res) => {
  const { key, value } = req.body ?? {};
  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const ps = access.access.playerState;
  if (typeof key !== "string" || typeof value !== "boolean") {
    return res.status(400).json({ error: "key (string) and value (boolean) are required" });
  }
  if (!(key in ps.policies)) {
    return res.status(400).json({ error: `Unknown policy: ${key}` });
  }

  (ps.policies as any)[key] = value;
  await persistPlayerStateForCity(access.access);
  res.json({ ok: true, policies: ps.policies });
});

export default router;
