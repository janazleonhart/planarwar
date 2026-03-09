//web-backend/server/healthRoutes.ts

import type { Express } from "express";

function getDbReadiness() {
  const hasDbUrl =
    !!process.env.PW_DATABASE_URL ||
    !!process.env.DATABASE_URL ||
    !!process.env.POSTGRES_URL ||
    !!process.env.PG_URL;

  const hasDbParts = !!process.env.PW_DB_HOST && !!process.env.PW_DB_USER && !!process.env.PW_DB_NAME;
  const ready = hasDbUrl || hasDbParts;

  return { hasDbUrl, hasDbParts, ready };
}

export function registerHealthRoutes(app: Express): void {
  app.get("/", (_req, res) => {
    res.json({ ok: true, message: "Planar War – Web backend online." });
  });

  app.get("/api/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "web-backend",
      pid: process.pid,
      uptimeMs: Math.floor(process.uptime() * 1000),
      now: new Date().toISOString(),
    });
  });

  app.get("/api/readyz", (_req, res) => {
    const { hasDbUrl, hasDbParts, ready } = getDbReadiness();

    const payload = {
      ok: ready,
      service: "web-backend",
      ready,
      db: {
        configured: ready,
        hasDbUrl,
        hasDbParts,
      },
      now: new Date().toISOString(),
    };

    if (ready) res.json(payload);
    else res.status(503).json(payload);
  });
}
