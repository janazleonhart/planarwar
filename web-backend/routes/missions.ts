//web-backend/routes/missions.ts

import { Router } from "express";
import { deriveCityMudConsumers, summarizeCityMudBridge } from "../domain/cityMudBridge";
import { applyMissionConsumerGuidance } from "../domain/missions";
import { completeMissionForPlayer, regenerateRegionMissionsForPlayer, startMissionForPlayer, tickPlayerState } from "../gameState";
import { withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

router.get("/offers", async (req, res) => {
  const access = await withPlayerAccessMutation(req, (access) => {
    const ps = access.playerState;
    const now = new Date();
    tickPlayerState(ps, now);
    if (!ps.currentOffers || ps.currentOffers.length === 0) {
      regenerateRegionMissionsForPlayer(access.playerId, ps.city.regionId as any, now);
    }

    const bridgeSummary = summarizeCityMudBridge(ps);
    const bridgeConsumers = deriveCityMudConsumers(bridgeSummary);
    const missions = applyMissionConsumerGuidance(ps.currentOffers, bridgeSummary, bridgeConsumers);
    ps.currentOffers = missions;

    return { missions, activeMissions: ps.activeMissions, threatWarnings: ps.threatWarnings ?? [], bridgeSummary, bridgeConsumers };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  return res.json(access.value);
});

router.post("/start", async (req, res) => {
  const { missionId, heroId, preferredHeroId, armyId, preferredArmyId } = req.body as { missionId?: string; heroId?: string; preferredHeroId?: string; armyId?: string; preferredArmyId?: string };
  if (!missionId) return res.status(400).json({ error: "missionId is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const active = startMissionForPlayer(access.playerId, missionId, new Date(), preferredHeroId ?? heroId, preferredArmyId ?? armyId);
    if (!active) return { ok: false as const, code: 400, body: { error: "Mission not found or no available forces." } };

    const bridgeSummary = summarizeCityMudBridge(access.playerState);
    const bridgeConsumers = deriveCityMudConsumers(bridgeSummary);

    return {
      ok: true as const,
      body: { ok: true, activeMission: active, activeMissions: access.playerState.activeMissions, threatWarnings: access.playerState.threatWarnings ?? [], heroes: access.playerState.heroes, armies: access.playerState.armies, bridgeSummary, bridgeConsumers, missionSupport: active.mission.supportGuidance ?? bridgeConsumers.missionBoard },
    };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

router.post("/complete", async (req, res) => {
  const { instanceId } = req.body as { instanceId?: string };
  if (!instanceId) return res.status(400).json({ error: "instanceId is required" });

  const access = await withPlayerAccessMutation(req, (access) => {
    const result = completeMissionForPlayer(access.playerId, instanceId, new Date());
    if (result.status !== "ok") {
      return { ok: false as const, code: 400, body: { error: result.message ?? "Unable to complete mission", status: result.status } };
    }

    return { ok: true as const, body: { ok: true, result, activeMissions: access.playerState.activeMissions, heroes: access.playerState.heroes, armies: access.playerState.armies, resources: access.playerState.resources, regionWar: access.playerState.regionWar } };
  });

  if (access.ok === false) return res.status(access.status).json({ error: access.error });
  if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
  return res.json(access.value.body);
});

router.post("/refresh_region", async (req, res) => {
  try {
    const { regionId } = req.body as { regionId?: string };
    if (!regionId) return res.status(400).json({ error: "regionId is required" });

    const access = await withPlayerAccessMutation(req, (access) => {
      const offers = regenerateRegionMissionsForPlayer(access.playerId, regionId as any, new Date());
      if (!offers) return { ok: false as const, code: 404, body: { error: "Player not found" } };
      return { ok: true as const, body: { ok: true, regionId, offers } };
    });

    if (access.ok === false) return res.status(access.status).json({ error: access.error });
    if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
    return res.json(access.value.body);
  } catch (err) {
    console.error("refresh_region error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
