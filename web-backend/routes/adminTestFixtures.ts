// web-backend/routes/adminTestFixtures.ts

import express from "express";

// This router is intentionally "safe": it must not mutate world state.
// It exists so Mother Brain (and humans) can run deterministic admin-facing smoke tests.

const router = express.Router();

type PingRequest = { ping?: number | string };

router.get("/ping", (_req, res) => {
  res.json({ ok: true, pong: "pong" });
});

router.post("/ping", (req, res) => {
  const body = (req.body ?? {}) as PingRequest;
  const ping = body.ping ?? 1;

  // Echo back a normalized value for deterministic assertions.
  const pong = typeof ping === "string" ? ping : Number(ping);

  res.json({ ok: true, pong });
});

export default router;
