//backend/src/routes/workshop.ts

import { Router } from "express";
import {
  DEMO_PLAYER_ID,
  getPlayerState,
  startWorkshopJobForPlayer,
  completeWorkshopJobForPlayer,
  HeroAttachmentKind,
} from "../gameState";

const router = Router();

// Start a new craft job
router.post("/craft", (req, res) => {
  const { kind } = req.body as { kind?: HeroAttachmentKind };

  if (!kind) {
    return res.status(400).json({ error: "kind is required" });
  }

  const now = new Date();
  const result = startWorkshopJobForPlayer(
    DEMO_PLAYER_ID,
    kind,
    now
  );

  if (result.status !== "ok" || !result.job) {
    return res.status(400).json({
      error: result.message ?? "Unable to start workshop job.",
      status: result.status,
    });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    job: result.job,
    workshopJobs: ps.workshopJobs,
    resources: ps.resources,
  });
});

// Complete a finished craft job and auto-equip its item
router.post("/collect", (req, res) => {
  const { jobId } = req.body as { jobId?: string };

  if (!jobId) {
    return res.status(400).json({ error: "jobId is required" });
  }

  const now = new Date();
  const result = completeWorkshopJobForPlayer(
    DEMO_PLAYER_ID,
    jobId,
    now
  );

  if (result.status !== "ok") {
    return res.status(400).json({
      error: result.message ?? "Unable to complete workshop job.",
      status: result.status,
    });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    job: result.job,
    workshopJobs: ps.workshopJobs,
    heroes: ps.heroes,
    resources: ps.resources,
  });
});

export default router;
