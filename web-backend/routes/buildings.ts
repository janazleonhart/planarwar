//web-backend/routes/buildings.ts

import { Router } from "express";
import { buildBuildingForPlayer, upgradeBuildingForPlayer } from "../gameState";
import type { BuildingKind } from "../gameState";
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

router.post("/construct", async (req, res) => {
  const { kind, serviceMode } = req.body as { kind?: BuildingKind; serviceMode?: InfrastructureMode };
  if (!kind) return res.status(400).json({ error: "kind is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const mode: InfrastructureMode = serviceMode === "npc_public" ? "npc_public" : "private_city";
    const before = cloneResources(access.playerState.resources);
    let publicService: AppliedPublicInfrastructureUsage | null = null;
    const wrapped = withInfrastructureRollback(
      access.playerState,
      () => buildBuildingForPlayer(access.playerId, kind, new Date()),
      (result) => {
        if (result.status !== "ok" || !result.building) {
          return { ok: false as const, error: result.message ?? "Unable to construct building." };
        }
        const baseCosts = diffSpentResources(before, access.playerState.resources);
        const levy = applyPublicInfrastructureUsage(access.playerState, "building_construct", mode, baseCosts, new Date());
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
        building: wrapped.value.building,
        city: access.playerState.city,
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

router.post("/upgrade", async (req, res) => {
  const { buildingId, serviceMode } = req.body as { buildingId?: string; serviceMode?: InfrastructureMode };
  if (!buildingId) return res.status(400).json({ error: "buildingId is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const mode: InfrastructureMode = serviceMode === "npc_public" ? "npc_public" : "private_city";
    const before = cloneResources(access.playerState.resources);
    let publicService: AppliedPublicInfrastructureUsage | null = null;
    const wrapped = withInfrastructureRollback(
      access.playerState,
      () => upgradeBuildingForPlayer(access.playerId, buildingId, new Date()),
      (result) => {
        if (result.status !== "ok" || !result.building) {
          return { ok: false as const, error: result.message ?? "Unable to upgrade building." };
        }
        const baseCosts = diffSpentResources(before, access.playerState.resources);
        const levy = applyPublicInfrastructureUsage(access.playerState, "building_upgrade", mode, baseCosts, new Date());
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
        building: wrapped.value.building,
        city: access.playerState.city,
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
