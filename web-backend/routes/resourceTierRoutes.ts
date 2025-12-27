//backend/src/routes/resourceTierRoutes.ts

import { Router } from "express";
import { getDemoPlayer, tickPlayerState, getOrInitResourceTier } from "../gameState";
import type { ResourceKey } from "../domain/resources";

export const resourceTierRouter = Router();

interface TierUpPayload {
  resourceKey: ResourceKey;
}

resourceTierRouter.post("/tier-up", (req, res) => {
  const now = new Date();
  const ps = getDemoPlayer();
  tickPlayerState(ps, now);

  const { resourceKey } = req.body as TierUpPayload;
  if (!resourceKey) {
    return res.status(400).json({ error: "Missing resourceKey" });
  }

  const track = getOrInitResourceTier(ps, resourceKey);
  const nextTier = track.tier + 1;

  const baseWealth = 100;
  const baseMaterials = 80;
  const scale = Math.pow(1.3, nextTier - 1);

  const costWealth = Math.round(baseWealth * scale);
  const costMaterials = Math.round(baseMaterials * scale);

  if (ps.resources.wealth < costWealth || ps.resources.materials < costMaterials) {
    return res.status(400).json({ error: "Not enough resources to tier up." });
  }

  ps.resources.wealth -= costWealth;
  ps.resources.materials -= costMaterials;

  track.tier = nextTier;
  track.totalInvested += costWealth + costMaterials;

  ps.eventLog.push({
    id: `evt_resource_tier_${resourceKey}_${Date.now()}`,
    kind: "resource_tier_up",
    timestamp: now.toISOString(),
    message: `Resource mastery for ${resourceKey} increased to Tier ${track.tier}.`,
  });

  return res.json({
    ok: true,
    resourceKey,
    tier: track.tier,
    totalInvested: track.totalInvested,
    remainingWealth: ps.resources.wealth,
    remainingMaterials: ps.resources.materials,
  });
});
