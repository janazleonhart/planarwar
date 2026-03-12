//web-backend/routes/workshop.ts

import { Router } from "express";
import {
  completeWorkshopJobForPlayer,
  getPlayerState,
  HeroAttachmentKind,
  startWorkshopJobForPlayer,
} from "../gameState";
import { persistPlayerStateForCity, resolvePlayerAccess } from "./playerCityAccess";

const router = Router();

router.post("/craft", async (req, res) => {
  const { kind } = req.body as { kind?: HeroAttachmentKind };
  if (!kind) return res.status(400).json({ error: "kind is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const result = startWorkshopJobForPlayer(access.access.playerId, kind, new Date());
  if (result.status !== "ok" || !result.job) {
    return res.status(400).json({ error: result.message ?? "Unable to start workshop job.", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  await persistPlayerStateForCity({ ...access.access, playerState: ps });
  res.json({ ok: true, job: result.job, workshopJobs: ps.workshopJobs, resources: ps.resources });
});

router.post("/collect", async (req, res) => {
  const { jobId } = req.body as { jobId?: string };
  if (!jobId) return res.status(400).json({ error: "jobId is required" });

  const access = await resolvePlayerAccess(req, { requireCity: true });
  if (access.ok === false) return res.status(access.status).json({ error: access.error });

  const result = completeWorkshopJobForPlayer(access.access.playerId, jobId, new Date());
  if (result.status !== "ok") {
    return res.status(400).json({ error: result.message ?? "Unable to complete workshop job.", status: result.status });
  }

  const ps = getPlayerState(access.access.playerId);
  if (!ps) return res.status(500).json({ error: "Player state missing." });

  await persistPlayerStateForCity({ ...access.access, playerState: ps });
  res.json({ ok: true, job: result.job, workshopJobs: ps.workshopJobs, heroes: ps.heroes, resources: ps.resources });
});

export default router;
