// web-backend/routes/city.ts

import { Router } from "express";

import { getPlayerState, morphCityForPlayer, tierUpCityForPlayer } from "../gameState";
import {
  createCityForViewer,
  renameCityForViewer,
  resolvePlayerAccess,
  resolveViewer,
  suggestCityName,
} from "./playerCityAccess";

const router = Router();

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
    const access = await resolvePlayerAccess(req, { requireCity: true });
    if (access.ok === false) return res.status(access.status).json({ ok: false, error: access.error });

    const now = new Date();
    const result = tierUpCityForPlayer(access.access.playerId, now);
    if (result.status === "ok") return res.json({ ok: true, result });
    return res.json({ ok: false, result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

router.post("/morph", async (req, res) => {
  try {
    const access = await resolvePlayerAccess(req, { requireCity: true });
    if (access.ok === false) return res.status(access.status).json({ ok: false, error: access.error });

    const specializationId = String(req.body?.specializationId ?? "").trim();
    if (!specializationId) {
      return res.status(400).json({ ok: false, error: "specializationId is required" });
    }

    const now = new Date();
    const result = morphCityForPlayer(access.access.playerId, specializationId, now);
    if (result.status === "ok") return res.json({ ok: true, result });
    return res.json({ ok: false, result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

router.get("/", async (req, res) => {
  try {
    const access = await resolvePlayerAccess(req, { requireCity: true });
    if (access.ok === false) return res.status(access.status).json({ ok: false, error: access.error });

    const ps = getPlayerState(access.access.playerId);
    if (!ps) return res.status(404).json({ ok: false, error: "no_player_state" });

    return res.json({ ok: true, playerId: access.access.playerId, city: ps.city, resources: ps.resources });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

export default router;
