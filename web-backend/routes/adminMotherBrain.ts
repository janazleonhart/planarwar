// web-backend/routes/adminMotherBrain.ts
//
// Admin endpoints for Mother Brain status.
// Reads from service_heartbeats (written by mother-brain v0.10+).
//
// Route base: /api/admin/mother_brain

import { Router } from "express";
import { db } from "../../worldcore/db/Database";
import { getPlayerState, summarizePlayerWorldConsequences } from "../gameState";
import { deriveWorldConsequenceHooks } from "../domain/worldConsequenceHooks";
import { deriveWorldConsequenceActions } from "../domain/worldConsequenceActions";
import { deriveWorldConsequenceConsumers } from "../domain/worldConsequenceConsumers";
import { deriveEconomyCartelResponseState } from "../domain/economyCartelResponse";
import { motherBrainHttpBase, proxyMotherBrain } from "./adminMotherBrain/motherBrainProxy";
import { readGoalsReportTail } from "./adminMotherBrain/motherBrainReports";
import { pgErrCode, toInt } from "./adminMotherBrain/motherBrainShared";

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

router.get("/city_signals", async (req, res) => {
  const playerId = typeof req.query?.playerId === "string" ? req.query.playerId.trim() : "demo_player";
  try {
    const ps = getPlayerState(playerId);
    if (!ps) {
      res.status(404).json({ ok: false, error: "player_not_found" });
      return;
    }

    res.json({
      ok: true,
      playerId,
      summary: summarizePlayerWorldConsequences(ps),
      ledger: ps.worldConsequences ?? [],
      pressureMap: ps.motherBrainPressureMap ?? [],
      propagatedState: ps.worldConsequenceState ?? null,
      hooks: deriveWorldConsequenceHooks(ps),
      actions: deriveWorldConsequenceActions(ps),
      responseState: deriveEconomyCartelResponseState(ps),
      consumers: deriveWorldConsequenceConsumers(ps),
    });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/goals/report_tail", async (req, res) => {
  const result = await readGoalsReportTail({ suiteQuery: req.query?.suite, linesQuery: req.query?.lines });
  res.status(result.status).json(result.json);
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

// ---------------------------------------------------------------------------
// Optional: proxy through to Mother Brain's own HTTP status server.
// This enables "Run goals now" and similar actions from the Admin UI without
// exposing Mother Brain cross-origin.
//
// Enable by setting one of:
//   - PW_MOTHER_BRAIN_HTTP_URL=http://127.0.0.1:8789
//   - MOTHER_BRAIN_HTTP_HOST + MOTHER_BRAIN_HTTP_PORT
// ---------------------------------------------------------------------------

router.get("/goals_proxy_info", async (_req, res) => {
  const base = motherBrainHttpBase();
  res.json({ ok: true, enabled: Boolean(base), baseUrl: base ? base : undefined });
});

router.get("/goals", async (_req, res) => {
  const r = await proxyMotherBrain("GET", "/goals");
  res.status(r.status).json(r.json);
});

router.post("/goals/run", async (_req, res) => {
  const r = await proxyMotherBrain("POST", "/goals/run", {});
  res.status(r.status).json(r.json);
});

router.post("/goals/clear", async (_req, res) => {
  const r = await proxyMotherBrain("POST", "/goals/clear", {});
  res.status(r.status).json(r.json);
});

router.post("/goals/set", async (req, res) => {
  const r = await proxyMotherBrain("POST", "/goals/set", req.body);
  res.status(r.status).json(r.json);
});

export default router;
