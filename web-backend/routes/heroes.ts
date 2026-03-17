//web-backend/routes/heroes.ts

import { Router } from "express";
import { equipHeroAttachmentForPlayer, HeroAttachmentKind, recruitHeroForPlayer } from "../gameState";
import type { HeroRole } from "../domain/heroes";
import { withPlayerAccessMutation } from "./playerCityAccess";
import {
  applyPublicInfrastructureUsage,
  cloneResources,
  diffSpentResources,
  withInfrastructureRollback,
  type AppliedPublicInfrastructureUsage,
} from "./publicInfrastructureSupport";
import type { InfrastructureMode } from "../domain/publicInfrastructure";

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
  const { role, serviceMode } = req.body as { role?: HeroRole; serviceMode?: InfrastructureMode };
  if (!role) return res.status(400).json({ error: "role is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const mode: InfrastructureMode = serviceMode === "npc_public" ? "npc_public" : "private_city";
    const before = cloneResources(access.playerState.resources);
    let publicService: AppliedPublicInfrastructureUsage | null = null;
    const wrapped = withInfrastructureRollback(
      access.playerState,
      () => recruitHeroForPlayer(access.playerId, role, new Date()),
      (result) => {
        if (result.status !== "ok" || !result.hero) {
          return { ok: false as const, error: result.message ?? "Unable to recruit hero." };
        }
        const baseCosts = diffSpentResources(before, access.playerState.resources);
        const levy = applyPublicInfrastructureUsage(access.playerState, "hero_recruit", mode, baseCosts, new Date());
        if (levy.ok === false) return { ok: false as const, error: levy.error };
        publicService = levy.usage;
        return { ok: true as const };
      }
    );

    if (wrapped.ok === false) {
      return { ok: false as const, code: 400, body: { error: wrapped.error, status: "public_service_blocked" } };
    }

    return {
      ok: true as const,
      body: {
        ok: true,
        hero: wrapped.value.hero,
        heroes: access.playerState.heroes,
        resources: access.playerState.resources,
        publicInfrastructure: access.playerState.publicInfrastructure,
        publicService,
      },
    };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

export default router;
