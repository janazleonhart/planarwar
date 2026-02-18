// web-backend/routes/adminMotherBrain.ts
//
// Admin endpoints for Mother Brain status.
// Reads from service_heartbeats (written by mother-brain v0.10+).
//
// Route base: /api/admin/mother_brain

import { Router } from "express";
import { db } from "../../worldcore/db/Database";

const router = Router();

function pgErrCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as any;
  return typeof anyErr.code === "string" ? anyErr.code : null;
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

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
    // If migration hasn't been applied yet, don't 500 the UI.
    // Postgres codes:
    //  - 42P01 undefined_table
    //  - 42703 undefined_column
    const code = pgErrCode(err);
    if (code === "42P01" || code === "42703") {
      res.json({
        ok: true,
        status: null,
        warning: "service_heartbeats_missing_or_outdated",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Optional wave-budget caps table (spawn_wave_budgets).
// Mother Brain reads this table (if present) to compute remaining budget.

router.get("/wave_budget", async (_req, res) => {
  try {
    const capsQ = await db.query(
      `
      SELECT shard_id, type, cap, policy, updated_at
      FROM spawn_wave_budgets
      ORDER BY shard_id, type
      `,
    );

    const usageQ = await db.query(
      `
      SELECT shard_id, type, COUNT(*)::INT AS count
      FROM spawn_points
      WHERE spawn_id LIKE 'brain:%'
      GROUP BY shard_id, type
      ORDER BY shard_id, type
      `,
    );

    res.json({ ok: true, caps: capsQ.rows, usage: usageQ.rows });
  } catch (err: unknown) {
    const code = pgErrCode(err);
    if (code === "42P01" || code === "42703") {
      res.json({
        ok: true,
        caps: [],
        usage: [],
        warning: "spawn_wave_budgets_missing_or_outdated",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/wave_budget", async (req, res) => {
  try {
    const shardId = typeof req.body?.shardId === "string" ? req.body.shardId.trim() : "";
    const type = typeof req.body?.type === "string" ? req.body.type.trim() : "";
    const cap = toInt(req.body?.cap);
    const policy = typeof req.body?.policy === "string" ? req.body.policy.trim() : "hard";

    if (!shardId || !type) {
      res.status(400).json({ ok: false, error: "shardId_and_type_required" });
      return;
    }
    if (cap == null || cap < 0) {
      res.status(400).json({ ok: false, error: "cap_must_be_a_non_negative_int" });
      return;
    }

    await db.query(
      `
      INSERT INTO spawn_wave_budgets (shard_id, type, cap, policy, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (shard_id, type)
      DO UPDATE SET cap = EXCLUDED.cap, policy = EXCLUDED.policy, updated_at = now()
      `,
      [shardId, type, cap, policy || "hard"],
    );

    res.json({ ok: true });
  } catch (err: unknown) {
    const code = pgErrCode(err);
    if (code === "42P01" || code === "42703") {
      res.status(409).json({
        ok: false,
        error: "spawn_wave_budgets_missing_or_outdated",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete("/wave_budget/:shardId/:type", async (req, res) => {
  try {
    const shardId = typeof req.params.shardId === "string" ? req.params.shardId.trim() : "";
    const type = typeof req.params.type === "string" ? req.params.type.trim() : "";

    if (!shardId || !type) {
      res.status(400).json({ ok: false, error: "shardId_and_type_required" });
      return;
    }

    await db.query(
      `
      DELETE FROM spawn_wave_budgets
      WHERE shard_id = $1
        AND type = $2
      `,
      [shardId, type],
    );

    res.json({ ok: true });
  } catch (err: unknown) {
    const code = pgErrCode(err);
    if (code === "42P01" || code === "42703") {
      res.status(409).json({
        ok: false,
        error: "spawn_wave_budgets_missing_or_outdated",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
