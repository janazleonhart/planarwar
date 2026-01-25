// web-backend/routes/city.ts
//
// CityBuilder prototype routes.
// These are intentionally lightweight wrappers around the demo-style gameState module.

import { Router, type Request } from "express";

import {
  getPlayerState,
  tierUpCityForPlayer,
  morphCityForPlayer,
  DEMO_PLAYER_ID,
} from "../gameState";

import { PostgresAuthService } from "../../worldcore/auth/PostgresAuthService";

const router = Router();

// ----------------------------
// Auth helper (Bearer token)
// ----------------------------

function getBearerToken(req: Request): string | null {
  const raw = req.headers.authorization;
  if (typeof raw !== "string") return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function resolvePlayerId(req: Request): Promise<string> {
  const token = getBearerToken(req);
  if (!token) return DEMO_PLAYER_ID;

  const auth = new PostgresAuthService();
  const payload = await auth.verifyToken(token);
  if (payload?.sub) return payload.sub;

  return DEMO_PLAYER_ID;
}

// ----------------------------
// Routes
// ----------------------------

// POST /api/city/tier-up
router.post("/tier-up", async (req, res) => {
  try {
    const playerId = await resolvePlayerId(req);
    const now = new Date();

    // tierUpCityForPlayer() already ticks internally.
    const result = tierUpCityForPlayer(playerId, now);

    if (result.status === "ok") return res.json({ ok: true, result });
    return res.json({ ok: false, result });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

// POST /api/city/morph
// body: { specializationId: string }
router.post("/morph", async (req, res) => {
  try {
    const playerId = await resolvePlayerId(req);
    const now = new Date();

    const specializationId = String(req.body?.specializationId ?? "").trim();
    if (!specializationId) {
      return res.status(400).json({ ok: false, error: "specializationId is required" });
    }

    // morphCityForPlayer() already ticks internally.
    const result = morphCityForPlayer(playerId, specializationId, now);

    if (result.status === "ok") return res.json({ ok: true, result });
    return res.json({ ok: false, result });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

// GET /api/city (debug)
router.get("/", async (req, res) => {
  try {
    const playerId = await resolvePlayerId(req);
    const ps = getPlayerState(playerId);

    if (!ps) return res.status(404).json({ ok: false, error: "no_player_state" });

    return res.json({ ok: true, playerId, city: ps.city, resources: ps.resources });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

export default router;
