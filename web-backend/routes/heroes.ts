//web-backend/routes/heroes.ts

import { Router } from "express";
import {
  equipHeroAttachmentForPlayer,
  getPlayerState,
  HeroAttachmentKind,
  recruitHeroForPlayer,
} from "../gameState";
import type { HeroRole } from "../domain/heroes";
import { resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.post("/equip_attachment", async (req, res) => {
  const { heroId, kind } = req.body as { heroId?: string; kind?: HeroAttachmentKind };
  if (!heroId || !kind) return res.status(400).json({ error: "heroId and kind are required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const now = new Date();
  const result = equipHeroAttachmentForPlayer(access.access.playerId, heroId, kind, now);
  if (result.status !== "ok" || !result.hero) {
    return res.status(400).json({ error: result.message ?? "Unable to equip attachment.", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  res.json({ ok: true, hero: result.hero, heroes: ps.heroes, resources: ps.resources });
});

router.post("/recruit", async (req, res) => {
  const { role } = req.body as { role?: HeroRole };
  if (!role) return res.status(400).json({ error: "role is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const now = new Date();
  const result = recruitHeroForPlayer(access.access.playerId, role, now);
  if (result.status !== "ok" || !result.hero) {
    return res.status(400).json({ error: result.message ?? "Unable to recruit hero.", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  res.json({ ok: true, hero: result.hero, heroes: ps.heroes, resources: ps.resources });
});

export default router;

