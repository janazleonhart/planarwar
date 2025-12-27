//backend/src/routes/heroes.ts

import { Router } from "express";
import {
  DEMO_PLAYER_ID,
  getPlayerState,
  equipHeroAttachmentForPlayer,
  HeroAttachmentKind,
  recruitHeroForPlayer,
} from "../gameState";

import type { HeroRole } from "../domain/heroes";

const router = Router();

// Equip a hero attachment (simple gear v1)
router.post("/equip_attachment", (req, res) => {
  const { heroId, kind } = req.body as {
    heroId?: string;
    kind?: HeroAttachmentKind;
  };

  if (!heroId || !kind) {
    return res
      .status(400)
      .json({ error: "heroId and kind are required" });
  }

  const now = new Date();
  const result = equipHeroAttachmentForPlayer(
    DEMO_PLAYER_ID,
    heroId,
    kind,
    now
  );

  if (result.status !== "ok" || !result.hero) {
    return res.status(400).json({
      error: result.message ?? "Unable to equip attachment.",
      status: result.status,
    });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(500).json({ error: "Player state missing." });
  }

  res.json({
    ok: true,
    hero: result.hero,
    heroes: ps.heroes,
    resources: ps.resources,
  });
});

// Recruit a new hero of a given role
router.post("/recruit", (req, res) => {
    const { role } = req.body as { role?: HeroRole };
  
    if (!role) {
      return res
        .status(400)
        .json({ error: "role is required" });
    }
  
    const now = new Date();
    const result = recruitHeroForPlayer(
      DEMO_PLAYER_ID,
      role,
      now
    );
  
    if (result.status !== "ok" || !result.hero) {
      return res.status(400).json({
        error: result.message ?? "Unable to recruit hero.",
        status: result.status,
      });
    }
  
    const ps = getPlayerState(DEMO_PLAYER_ID);
    if (!ps) {
      return res.status(500).json({ error: "Player state missing." });
    }
  
    res.json({
      ok: true,
      hero: result.hero,
      heroes: ps.heroes,
      resources: ps.resources,
    });
  });

export default router;
