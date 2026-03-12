//web-backend/routes/workshop.ts

import { Router } from "express";
import { completeWorkshopJobForPlayer, HeroAttachmentKind, startWorkshopJobForPlayer } from "../gameState";
import { withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

router.post("/craft", async (req, res) => {
  const { kind } = req.body as { kind?: HeroAttachmentKind };
  if (!kind) return res.status(400).json({ error: "kind is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = startWorkshopJobForPlayer(access.playerId, kind, new Date());
    if (result.status !== "ok" || !result.job) {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to start workshop job.", status: result.status } };
    }

    return { ok: true as const, body: { ok: true, job: result.job, workshopJobs: access.playerState.workshopJobs, resources: access.playerState.resources } };
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

    return { ok: true as const, body: { ok: true, job: result.job, workshopJobs: access.playerState.workshopJobs, heroes: access.playerState.heroes, resources: access.playerState.resources } };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

export default router;
