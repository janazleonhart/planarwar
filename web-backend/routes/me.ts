//web-backend/routes/me.ts

import type { Request } from "express";
import { Router } from "express";

import { PostgresAuthService } from "../../worldcore/auth/PostgresAuthService";
import { DEMO_PLAYER_ID, getOrCreatePlayerState } from "../gameState";

const router = Router();

const auth = new PostgresAuthService();

function getBearerToken(req: Request): string | null {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m?.[1] ?? null;
}

async function resolveViewer(req: Request): Promise<{ userId: string; username: string; playerId: string }> {
  const token = getBearerToken(req);
  if (!token) return { userId: "demo", username: "Demo", playerId: DEMO_PLAYER_ID };

  const payload = await auth.verifyToken(token);
  if (!payload) return { userId: "demo", username: "Demo", playerId: DEMO_PLAYER_ID };

  const anyPayload = payload as any;

  const userId =
    String(anyPayload.sub ?? anyPayload.account?.id ?? anyPayload.userId ?? anyPayload.accountId ?? "").trim() ||
    "demo";

  const username =
    String(
      anyPayload.account?.displayName ??
        anyPayload.account?.display_name ??
        anyPayload.displayName ??
        anyPayload.username ??
        anyPayload.email ??
        ""
    ).trim() || "User";

  return { userId, username, playerId: userId !== "demo" ? userId : DEMO_PLAYER_ID };
}

router.get("/me", async (req, res) => {
  const viewer = await resolveViewer(req);
  const ps = getOrCreatePlayerState(viewer.playerId);

  return res.json({
    ok: true,
    userId: viewer.userId,
    username: viewer.username,
    resources: ps.resources,
    city: ps.city,
  });
});

export default router;
