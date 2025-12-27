//backend/src/routes/city.ts

import { Router } from "express";
import {
  DEMO_PLAYER_ID,
  getPlayerState,
  tickPlayerState,
  tierUpCityForPlayer,
  morphCityForPlayer,
} from "../gameState";
import {
  getBuildingUpgradeCost,
  getBuildingConstructionCost,
  maxBuildingSlotsForTier,
  createBuilding
} from "../domain/city";

import type { BuildingKind } from "../domain/city";

const router = Router();

// ---- Upgrade existing building ----

router.post("/upgrade-building", (req, res) => {
  const { buildingId } = req.body ?? {};
  if (!buildingId || typeof buildingId !== "string") {
    return res.status(400).json({ error: "buildingId is required" });
  }

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(404).json({ error: "Player not found" });
  }

  // apply passive production before we modify anything
  tickPlayerState(ps, new Date());

  const building = ps.city.buildings.find((b) => b.id === buildingId);
  if (!building) {
    return res.status(404).json({ error: "Building not found" });
  }

  const cost = getBuildingUpgradeCost(building);

  if (
    ps.resources.materials < cost.materials ||
    ps.resources.wealth < cost.wealth
  ) {
    return res.status(400).json({
      error: "Not enough resources",
      required: cost,
      resources: ps.resources,
    });
  }

  ps.resources.materials -= cost.materials;
  ps.resources.wealth -= cost.wealth;

  building.level += 1;

  console.log(
    `[City] Upgraded ${building.id} to level ${building.level} (cost M:${cost.materials}, W:${cost.wealth})`
  );

  res.json({
    ok: true,
    building,
    city: ps.city,
    resources: ps.resources,
    cost,
  });
});

// ---- Build new structure ----

router.post("/build", (req, res) => {
  const { kind } = req.body ?? {};

  const ps = getPlayerState(DEMO_PLAYER_ID);
  if (!ps) {
    return res.status(404).json({ error: "Player not found" });
  }

  tickPlayerState(ps, new Date());

  if (typeof kind !== "string") {
    return res
      .status(400)
      .json({ error: "kind is required (housing|farmland|mine|arcane_spire)" });
  }

  const validKinds: BuildingKind[] = [
    "housing",
    "farmland",
    "mine",
    "arcane_spire",
  ];
  if (!validKinds.includes(kind as BuildingKind)) {
    return res.status(400).json({ error: `Unknown building kind: ${kind}` });
  }

  const city = ps.city;
  const usedSlots = city.buildings.length;
  const maxSlots = maxBuildingSlotsForTier(city.tier);

  if (usedSlots >= maxSlots) {
    return res.status(400).json({
      error: "No free building slots at current tier",
      usedSlots,
      maxSlots,
      tier: city.tier,
    });
  }

  const cost = getBuildingConstructionCost(kind as BuildingKind);

  if (
    ps.resources.materials < cost.materials ||
    ps.resources.wealth < cost.wealth
  ) {
    return res.status(400).json({
      error: "Not enough resources to construct building",
      required: cost,
      resources: ps.resources,
    });
  }

  ps.resources.materials -= cost.materials;
  ps.resources.wealth -= cost.wealth;

  const building = createBuilding(kind as BuildingKind, city);
  city.buildings.push(building);

  console.log(
    `[City] Constructed new ${kind} (${building.id}) at tier ${city.tier} (slots ${usedSlots + 1}/${maxSlots})`
  );

  res.json({
    ok: true,
    building,
    city,
    resources: ps.resources,
    cost,
    usedSlots: usedSlots + 1,
    maxSlots,
  });
});

// ---- Tier up city ----

router.post("/tier-up", (req, res) => {
    const now = new Date();
  
    // Later: use real auth to get playerId
    const result = tierUpCityForPlayer(DEMO_PLAYER_ID, now);
  
    if (result.status === "ok") {
      return res.json({
        ok: true,
        newTier: result.newTier,
        cost: result.cost,
      });
    }
  
    return res.status(400).json({
      ok: false,
      error: result.message ?? "Tier up failed",
      cost: result.cost,
    });
  });

  router.post("/morph", (req, res) => {
    const now = new Date();
    const { morphId } = req.body as { morphId?: string };
  
    if (!morphId) {
      return res.status(400).json({ ok: false, error: "morphId is required." });
    }
  
    const result = morphCityForPlayer(DEMO_PLAYER_ID, morphId, now);
  
    if (result.status === "ok") {
      return res.json({ ok: true, ...result });
    }
  
    return res.status(400).json({ ok: false, ...result });
  });
  

export default router;
