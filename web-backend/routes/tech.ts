//web-backend/routes/tech.ts

import { Router } from "express";
import { startResearchForPlayer } from "../gameState";
import { withPlayerAccessMutation } from "./playerCityAccess";
import { applyPublicInfrastructureUsage, cloneResources, diffSpentResources, withInfrastructureRollback } from "./publicInfrastructureSupport";
import type { InfrastructureMode } from "../domain/publicInfrastructure";

const router = Router();

router.post("/start", async (req, res) => {
  const { techId, serviceMode } = req.body as { techId?: string; serviceMode?: InfrastructureMode };
  if (!techId) return res.status(400).json({ error: "techId is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const mode: InfrastructureMode = serviceMode === "npc_public" ? "npc_public" : "private_city";
    const before = cloneResources(access.playerState.resources);
    const wrapped = withInfrastructureRollback(
      access.playerState,
      () => startResearchForPlayer(access.playerId, techId, new Date()),
      (result) => {
        if (result.status !== "ok") {
          return { ok: false as const, error: result.message ?? result.status };
        }
        const baseCosts = diffSpentResources(before, access.playerState.resources);
        const levy = applyPublicInfrastructureUsage(access.playerState, "tech_research", mode, baseCosts, new Date());
        if (levy.ok === false) return { ok: false as const, error: levy.error };
        return { ok: true as const };
      }
    );
    if (wrapped.ok === false) {
      return { ok: false as const, code: 400, body: { error: wrapped.error, status: "public_service_blocked" } };
    }

    return { ok: true as const, body: { status: "ok", research: wrapped.value.research, publicInfrastructure: access.playerState.publicInfrastructure, resources: access.playerState.resources } };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

export default router;
