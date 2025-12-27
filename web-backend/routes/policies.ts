//backend/src/routes/policies.ts

import { Router } from "express";
import { DEMO_PLAYER_ID, getPlayerState, tickPlayerState } from "../gameState";

import type { PoliciesState } from "../gameState";

const router = Router();

// Get current policies state
router.get("/", (_req, res) => {
  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(404).json({ error: "Player not found" });
  }

  // apply tick so stats reflect current policies
  tickPlayerState(ps, new Date());

  res.json({
    policies: ps.policies,
  });
});

// Toggle a single policy
router.post("/toggle", (req, res) => {
  const { key, value } = req.body ?? {};

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(404).json({ error: "Player not found" });
  }

  if (typeof key !== "string" || typeof value !== "boolean") {
    return res
      .status(400)
      .json({ error: "key (string) and value (boolean) are required" });
  }

  if (!(key in ps.policies)) {
    return res.status(400).json({ error: `Unknown policy: ${key}` });
  }

  (ps.policies as any)[key] = value;

  console.log(`[Policies] Set ${key} = ${value}`);

  res.json({
    ok: true,
    policies: ps.policies,
  });
});

export default router;
