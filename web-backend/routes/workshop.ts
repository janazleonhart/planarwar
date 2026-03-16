//web-backend/routes/workshop.ts

import { Router } from "express";
import { completeWorkshopJobForPlayer, HeroAttachmentKind, startWorkshopJobForPlayer } from "../gameState";
import { withPlayerAccessMutation } from "./playerCityAccess";
import { applyPublicInfrastructureUsage, cloneResources, diffSpentResources, withInfrastructureRollback } from "./publicInfrastructureSupport";
import type { InfrastructureMode } from "../domain/publicInfrastructure";

const router = Router();

router.post("/craft", async (req, res) => {
  const { kind, serviceMode } = req.body as { kind?: HeroAttachmentKind; serviceMode?: InfrastructureMode };
  if (!kind) return res.status(400).json({ error: "kind is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const mode: InfrastructureMode = serviceMode === "npc_public" ? "npc_public" : "private_city";
    const before = cloneResources(access.playerState.resources);
    const wrapped = withInfrastructureRollback(
      access.playerState,
      () => startWorkshopJobForPlayer(access.playerId, kind, new Date()),
      (result) => {
        if (result.status !== "ok" || !result.job) {
          return { ok: false as const, error: result.message ?? "Unable to start workshop job." };
        }
        const baseCosts = diffSpentResources(before, access.playerState.resources);
        const levy = applyPublicInfrastructureUsage(access.playerState, "workshop_craft", mode, baseCosts, new Date());
        if (levy.ok === false) return { ok: false as const, error: levy.error };
        if (mode === "npc_public") {
          result.job.finishesAt = new Date(new Date(result.job.finishesAt).getTime() + levy.quote.queueMinutes * 60 * 1000).toISOString();
        }
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
        job: wrapped.value.job,
        workshopJobs: access.playerState.workshopJobs,
        resources: access.playerState.resources,
        publicInfrastructure: access.playerState.publicInfrastructure,
      },
    };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

router.post("/collect", async (req, res) => {
  const { jobId } = req.body as { jobId?: string };
  if (!jobId) return res.status(400).json({ error: "jobId is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = completeWorkshopJobForPlayer(access.playerId, jobId, new Date());
    if (result.status !== "ok") {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to complete workshop job.", status: result.status } };
    }

    return {
      ok: true as const,
      body: {
        ok: true,
        job: result.job,
        workshopJobs: access.playerState.workshopJobs,
        heroes: access.playerState.heroes,
        resources: access.playerState.resources,
        publicInfrastructure: access.playerState.publicInfrastructure,
      },
    };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

export default router;
