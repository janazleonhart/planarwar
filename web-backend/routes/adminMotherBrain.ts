// web-backend/routes/adminMotherBrain.ts
//
// Admin endpoints for Mother Brain status.
// Reads from service_heartbeats (written by mother-brain v0.10+).
//
// Route base: /api/admin/mother_brain

import { Router } from "express";
import { db } from "../../worldcore/db/Database";

const router = Router();

function motherBrainHttpBase(): string | null {
  const explicit = typeof process.env.PW_MOTHER_BRAIN_HTTP_URL === "string" ? process.env.PW_MOTHER_BRAIN_HTTP_URL.trim() : "";
  if (explicit) return explicit.replace(/\/+$/, "");

  const portRaw = process.env.MOTHER_BRAIN_HTTP_PORT;
  const port = portRaw && String(portRaw).trim() !== "" ? Number(portRaw) : NaN;
  if (Number.isFinite(port) && port > 0) {
    const host = typeof process.env.MOTHER_BRAIN_HTTP_HOST === "string" && process.env.MOTHER_BRAIN_HTTP_HOST.trim()
      ? process.env.MOTHER_BRAIN_HTTP_HOST.trim()
      : "127.0.0.1";
    return `http://${host}:${port}`;
  }

  return null;
}

async function proxyMotherBrain(method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const base = motherBrainHttpBase();
  if (!base) {
    return {
      ok: false,
      status: 409,
      json: {
        ok: false,
        error: "mother_brain_http_proxy_disabled",
        detail: "Set PW_MOTHER_BRAIN_HTTP_URL or MOTHER_BRAIN_HTTP_PORT on web-backend to enable proxy.",
      },
    };
  }

  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2500);

  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    } as any);

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = { ok: false, error: "non_json_response" };
    }

    return { ok: res.ok, status: res.status, json };
  } catch (err: unknown) {
    return {
      ok: false,
      status: 502,
      json: {
        ok: false,
        error: "mother_brain_http_proxy_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    clearTimeout(t);
  }
}

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
  // body must be a JSON array of goals (forwarded verbatim)
  const r = await proxyMotherBrain("POST", "/goals/set", req.body);
  res.status(r.status).json(r.json);
});

export default router;
