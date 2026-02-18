// web-backend/routes/adminTestFixtures.ts

import express from "express";
import { db } from "../../worldcore/db/Database";

// This router is intentionally "safe": it must not mutate world state.
// It exists so Mother Brain (and humans) can run deterministic admin-facing smoke tests.

const router = express.Router();

type PingRequest = { ping?: number | string };

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return Math.floor(n);
}

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

// Returns deterministic server timestamps for smoke tests.
router.get("/time", (_req, res) => {
  const now = new Date();
  res.json({ ok: true, nowIso: now.toISOString(), nowUnixMs: now.getTime() });
});

// Echoes a tiny, safe subset of headers so callers can validate auth/proxy wiring.
router.get("/echo_headers", (req, res) => {
  const h = req.headers;
  res.json({
    ok: true,
    host: String(h.host ?? ""),
    userAgent: String(h["user-agent"] ?? ""),
    forwardedFor: String(h["x-forwarded-for"] ?? ""),
    forwardedProto: String(h["x-forwarded-proto"] ?? ""),
    requestId: String(h["x-request-id"] ?? ""),
  });
});

// Read-only DB sanity probe: returns row counts for a small set of tables.
// This must never mutate state.
router.get("/db_counts", async (req, res) => {
  const tables = [
    "spawn_points",
    "npcs",
    "items",
    "spells",
    "quests",
    "vendors",
  ];

  // Reserved for future (tailing, pagination, etc.). Keeps query surface stable.
  const lines = clampInt(Number(req.query.lines ?? "0"), 0, 0);
  void lines;

  const t0 = Date.now();
  try {
    // Quick connectivity check.
    await db.query("SELECT 1");

    const counts: Record<string, number> = {};
    for (const table of tables) {
      // Table names are hard-coded above (not user-provided) to prevent injection.
      const q = await db.query<{ c: string }>(`SELECT COUNT(*)::text as c FROM ${table}`);
      const c = Number(q.rows?.[0]?.c ?? "0");
      counts[table] = Number.isFinite(c) ? c : 0;
    }

    res.json({ ok: true, latencyMs: Date.now() - t0, counts });
  } catch (err: any) {
    res.status(503).json({
      ok: false,
      latencyMs: Date.now() - t0,
      error: String(err?.message ?? err),
    });
  }
});

export default router;
