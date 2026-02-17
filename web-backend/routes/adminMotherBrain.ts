// web-backend/routes/adminMotherBrain.ts
//
// Admin endpoints for Mother Brain status.
// Reads from service_heartbeats (written by mother-brain v0.10+).
//
// Route base: /api/admin/mother_brain

import { Router } from "express";
import { db } from "../../worldcore/db/Database";

const router = Router();

router.get("/status", async (_req, res) => {
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
      WHERE service_name = 'mother-brain'
      LIMIT 1
    `,
    );

    const row = q.rows?.[0] ?? null;
    res.json({ ok: true, status: row });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
