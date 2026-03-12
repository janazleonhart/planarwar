//web-backend/routes/heroes.ts

import { Router } from "express";
import { equipHeroAttachmentForPlayer, HeroAttachmentKind, recruitHeroForPlayer } from "../gameState";
import type { HeroRole } from "../domain/heroes";
import { withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

router.post("/equip_attachment", async (req, res) => {
  const { heroId, kind } = req.body as { heroId?: string; kind?: HeroAttachmentKind };
  if (!heroId || !kind) return res.status(400).json({ error: "heroId and kind are required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = equipHeroAttachmentForPlayer(access.playerId, heroId, kind, new Date());
    if (result.status !== "ok" || !result.hero) {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to equip attachment.", status: result.status } };
    }

    return { ok: true as const, body: { ok: true, hero: result.hero, heroes: access.playerState.heroes, resources: access.playerState.resources } };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

router.post("/recruit", async (req, res) => {
  const { role } = req.body as { role?: HeroRole };
  if (!role) return res.status(400).json({ error: "role is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = recruitHeroForPlayer(access.playerId, role, new Date());
    if (result.status !== "ok" || !result.hero) {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to recruit hero.", status: result.status } };
    }

    return { ok: true as const, body: { ok: true, hero: result.hero, heroes: access.playerState.heroes, resources: access.playerState.resources } };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

export default router;
