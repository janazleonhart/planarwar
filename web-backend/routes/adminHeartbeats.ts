// web-backend/routes/adminHeartbeats.ts
//
// Admin endpoints for service heartbeats.
// Reads from public.service_heartbeats (written by daemons such as mother-brain).
//
// Route base: /api/admin/heartbeats

import { Router } from "express";
import { db } from "../../worldcore/db/Database";

const router = Router();

function pgErrCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as any;
  return typeof anyErr.code === "string" ? anyErr.code : null;
}

router.get("/", async (_req, res) => {
  try {
    const q = await db.query(
      `
      SELECT
        service_name,
        instance_id,
        host,
        pid,
        version,
        mode,
        ready,
        last_tick,
        last_signature,
        last_status_json,
        started_at,
        last_tick_at,
        updated_at
      FROM service_heartbeats
      ORDER BY updated_at DESC
    `,
    );

    res.json({ ok: true, heartbeats: q.rows ?? [] });
  } catch (err: unknown) {
    // Migration not applied yet (or table schema drift) shouldn't nuke the admin UI.
    // Postgres codes:
    //  - 42P01 undefined_table
    //  - 42703 undefined_column
    const code = pgErrCode(err);
    if (code === "42P01" || code === "42703") {
      res.json({
        ok: true,
        heartbeats: [],
        warning: "service_heartbeats_missing_or_outdated",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
