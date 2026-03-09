//web-backend/server/heartbeat.ts

import { db } from "../../worldcore/db/Database";

export function startServiceHeartbeat(opts: { port: number }): void {
  const hbEveryMs = Math.max(Number(process.env.PW_HEARTBEAT_INTERVAL_MS || "5000"), 1000);
  let hbTick = 0;
  const serviceName = "web-backend";
  const instanceId = `planarwar:${process.pid}`;
  const hostLabel = process.env.HOSTNAME || "unknown";
  const startedAtIso = new Date().toISOString();

  async function writeHeartbeat() {
    hbTick++;

    let dbOk = false;
    let dbLatencyMs: number | null = null;

    const t0 = Date.now();
    try {
      await db.query("SELECT 1");
      dbOk = true;
      dbLatencyMs = Date.now() - t0;
    } catch {
      dbOk = false;
      dbLatencyMs = null;
    }

    const hasDbUrl =
      !!process.env.PW_DATABASE_URL ||
      !!process.env.DATABASE_URL ||
      !!process.env.POSTGRES_URL ||
      !!process.env.PG_URL;

    const hasDbParts = !!process.env.PW_DB_HOST && !!process.env.PW_DB_USER && !!process.env.PW_DB_NAME;
    const dbConfigured = hasDbUrl || hasDbParts;

    const status = {
      service: serviceName,
      pid: process.pid,
      startedAt: startedAtIso,
      now: new Date().toISOString(),
      http: { port: opts.port },
      db: { configured: dbConfigured, ok: dbOk, latencyMs: dbLatencyMs },
    };

    const signature = `db:${dbConfigured ? "cfg" : "nocfg"}:${dbOk ? "ok" : "bad"}`;

    const sql = `
      INSERT INTO public.service_heartbeats (
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
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW(),NOW())
      ON CONFLICT (service_name)
      DO UPDATE SET
        instance_id = EXCLUDED.instance_id,
        host = EXCLUDED.host,
        pid = EXCLUDED.pid,
        version = EXCLUDED.version,
        mode = EXCLUDED.mode,
        ready = EXCLUDED.ready,
        last_tick = EXCLUDED.last_tick,
        last_signature = EXCLUDED.last_signature,
        last_status_json = EXCLUDED.last_status_json,
        last_tick_at = NOW(),
        updated_at = NOW()
    `;

    try {
      await db.query(sql, [
        serviceName,
        instanceId,
        hostLabel,
        process.pid,
        process.env.npm_package_version || "0.0.0",
        "serve",
        dbOk,
        hbTick,
        signature,
        JSON.stringify(status),
      ]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[web-backend] heartbeat write failed (non-fatal)", err);
    }
  }

  void writeHeartbeat();
  const hb = setInterval(() => void writeHeartbeat(), hbEveryMs);
  hb.unref?.();
}
