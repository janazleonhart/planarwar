// web-backend/routes/city.ts

import { Router } from "express";

import { morphCityForPlayer, tierUpCityForPlayer } from "../gameState";
import { getCityTierConfig, getCityTierConfigStatus } from "../config/cityTierConfig";
import { createCityForViewer, renameCityForViewer, resolvePlayerAccess, resolveViewer, suggestCityName, withPlayerAccessMutation } from "./playerCityAccess";

const router = Router();

router.get("/config", async (_req, res) => {
  try {
    const config = getCityTierConfig();
    const status = getCityTierConfigStatus();
    return res.json({ ok: true, status, config });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});


router.post("/bootstrap", async (req, res) => {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer.isAuthenticated || viewer.isDemo) {
      return res.status(401).json({ ok: false, error: "auth_required" });
    }

    const rawName = String(req.body?.name ?? "").trim() || suggestCityName(viewer.username);
    const shardId = String(req.body?.shardId ?? "").trim() || "prime_shard";
    const result = await createCityForViewer(viewer, { name: rawName, shardId });

    return res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      playerId: viewer.playerId,
      city: result.playerState.city,
      resources: result.playerState.resources,
    });
  } catch (err: any) {
    const code = String(err?.message ?? "internal_error");
    const status =
      code === "city_name_taken" ? 409 :
      code === "city_exists" ? 409 :
      code.startsWith("city_name_") ? 400 :
      code === "auth_required" ? 401 : 500;
    return res.status(status).json({ ok: false, error: code });
  }
});

router.post("/rename", async (req, res) => {
  try {
    const viewer = await resolveViewer(req);
    if (!viewer.isAuthenticated || viewer.isDemo) {
      return res.status(401).json({ ok: false, error: "auth_required" });
    }

    const rawName = String(req.body?.name ?? "").trim();
    const result = await renameCityForViewer(viewer, rawName);
    return res.json({ ok: true, city: result.playerState.city });
  } catch (err: any) {
    const code = String(err?.message ?? "internal_error");
    const status =
      code === "city_name_taken" ? 409 :
      code.startsWith("city_name_") ? 400 :
      code === "no_city" ? 409 :
      code === "auth_required" ? 401 : 500;
    return res.status(status).json({ ok: false, error: code });
  }
});

router.post("/tier-up", async (req, res) => {
  try {
    const access = await withPlayerAccessMutation(req, (access) => {
      const result = tierUpCityForPlayer(access.playerId, new Date());
      if (result.status === "ok") return { ok: true as const, body: { ok: true, result } };
      return { ok: false as const, code: 200, body: { ok: false, result } };
    });

    if (access.ok === false) return res.status(access.status).json({ ok: false, error: access.error });
    if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
    return res.json(access.value.body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

router.post("/morph", async (req, res) => {
  try {
    const specializationId = String(req.body?.specializationId ?? "").trim();
    if (!specializationId) {
      return res.status(400).json({ ok: false, error: "specializationId is required" });
    }

    const access = await withPlayerAccessMutation(req, (access) => {
      const result = morphCityForPlayer(access.playerId, specializationId, new Date());
      if (result.status === "ok") return { ok: true as const, body: { ok: true, result } };
      return { ok: false as const, code: 200, body: { ok: false, result } };
    });

    if (access.ok === false) return res.status(access.status).json({ ok: false, error: access.error });
    if (!access.value.ok) return res.status(access.value.code).json(access.value.body);
    return res.json(access.value.body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

router.get("/", async (req, res) => {
  try {
    const access = await resolvePlayerAccess(req, { requireCity: true });
    if (access.ok === false) return res.status(access.status).json({ ok: false, error: access.error });

    return res.json({ ok: true, playerId: access.access.playerId, city: access.access.playerState.city, resources: access.access.playerState.resources });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

export default router;
