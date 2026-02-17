// web-backend/routes/adminHeartbeats.ts
//
// Admin endpoints for service heartbeats.
// Reads from public.service_heartbeats (written by daemons such as mother-brain).
//
// Route base: /api/admin/heartbeats

import { Router } from "express";
import fs from "fs";
import os from "os";

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

    res.json({ ok: true, heartbeats: q.rows ?? [], restart: { enabled: isRestartAllowed(), denyServices: ["web-backend"], detail: isRestartAllowed() ? undefined : "Set PW_ADMIN_ALLOW_RESTART=true on web-backend to allow admin-triggered restarts (dev only)." } });
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

function isRestartAllowed(): boolean {
  return String(process.env.PW_ADMIN_ALLOW_RESTART ?? "").toLowerCase() === "true";
}

function isLocalishHost(host: unknown): boolean {
  const h = typeof host === "string" ? host.trim().toLowerCase() : "";
  if (!h || h === "unknown") return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;

  // Allow the machine hostname (common when daemons self-report)
  const hn = os.hostname().toLowerCase();
  if (h === hn) return true;

  // Otherwise: treat as remote and deny (we only restart local processes in dev).
  return false;
}

function readProcCmdline(pid: number): string | null {
  try {
    // Linux only (your dev box is Ubuntu, so: fine). If /proc is unavailable, we just refuse.
    const buf = fs.readFileSync(`/proc/${pid}/cmdline`);
    const raw = buf.toString("utf8");
    return raw.replace(/\0/g, " ").trim();
  } catch {
    return null;
  }
}

function looksLikePlanarwarProcess(cmdline: string | null): boolean {
  if (!cmdline) return false;
  const s = cmdline.toLowerCase();
  // "node .../planarwar/..." or "ts-node-dev .../planarwar/..."
  return s.includes("planarwar") && (s.includes("node") || s.includes("ts-node") || s.includes("ts-node-dev"));
}

router.post("/restart", async (req, res) => {
  if (!isRestartAllowed()) {
    res.status(403).json({
      ok: false,
      error: "restart_disabled",
      detail:
        "Set PW_ADMIN_ALLOW_RESTART=true on web-backend to allow admin-triggered restarts (dev only).",
    });
    return;
  }

  const serviceName = String((req.body as any)?.serviceName ?? "").trim();
  if (!serviceName) {
    res.status(400).json({ ok: false, error: "missing_serviceName" });
    return;
  }

  // Hard rule: do not allow the admin panel to restart the web-backend that serves this API/UI.
  if (serviceName === "web-backend") {
    res.status(400).json({
      ok: false,
      error: "restart_denied_self_hosted_service",
      detail:
        "Restart is disabled for web-backend (it hosts this admin API/UI). Restart it manually via your dev supervisor (concurrently/systemd/etc).",
    });
    return;
  }

  try {
    const q = await db.query(
      `
      SELECT service_name, instance_id, host, pid, updated_at
      FROM service_heartbeats
      WHERE service_name = $1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
      [serviceName],
    );

    const row = q.rows?.[0];
    if (!row) {
      res.status(404).json({ ok: false, error: "service_not_found" });
      return;
    }

    const pid = Number(row.pid);
    if (!Number.isFinite(pid) || pid <= 0) {
      res.status(400).json({ ok: false, error: "invalid_pid", detail: row.pid });
      return;
    }

    if (!isLocalishHost(row.host)) {
      res.status(400).json({
        ok: false,
        error: "restart_denied_remote_host",
        detail: `Refusing to restart non-local host: ${String(row.host)}`,
      });
      return;
    }

    const cmdline = readProcCmdline(pid);
    if (!looksLikePlanarwarProcess(cmdline)) {
      res.status(400).json({
        ok: false,
        error: "restart_denied_unexpected_process",
        detail: cmdline ?? "(cmdline unavailable)",
      });
      return;
    }

    // SIGTERM first: watchers (ts-node-dev, nodemon, systemd) should respawn.
    process.kill(pid, "SIGTERM");

    res.json({ ok: true, serviceName, pid, action: "sigterm", cmdline });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/restart_many", async (req, res) => {
  if (!isRestartAllowed()) {
    res.status(403).json({
      ok: false,
      error: "restart_disabled",
      detail:
        "Set PW_ADMIN_ALLOW_RESTART=true on web-backend to allow admin-triggered restarts (dev only).",
    });
    return;
  }

  const raw = (req.body as any)?.serviceNames;
  const serviceNames = Array.isArray(raw)
    ? raw.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];

  if (serviceNames.length === 0) {
    res.status(400).json({ ok: false, error: "missing_serviceNames" });
    return;
  }

  // Always deny web-backend restart.
  const filtered = serviceNames.filter((s) => s !== "web-backend");

  const results: Array<{
    serviceName: string;
    ok: boolean;
    pid?: number;
    action?: "sigterm";
    error?: string;
    detail?: string;
  }> = [];

  for (const serviceName of filtered) {
    try {
      const q = await db.query(
        `
        SELECT service_name, instance_id, host, pid, updated_at
        FROM service_heartbeats
        WHERE service_name = $1
        ORDER BY updated_at DESC
        LIMIT 1
      `,
        [serviceName],
      );

      const row = q.rows?.[0];
      if (!row) {
        results.push({ serviceName, ok: false, error: "service_not_found" });
        continue;
      }

      const pid = Number(row.pid);
      if (!Number.isFinite(pid) || pid <= 0) {
        results.push({ serviceName, ok: false, error: "invalid_pid", detail: String(row.pid) });
        continue;
      }

      if (!isLocalishHost(row.host)) {
        results.push({
          serviceName,
          ok: false,
          error: "restart_denied_remote_host",
          detail: `Refusing to restart non-local host: ${String(row.host)}`,
        });
        continue;
      }

      const cmdline = readProcCmdline(pid);
      if (!looksLikePlanarwarProcess(cmdline)) {
        results.push({
          serviceName,
          ok: false,
          error: "restart_denied_unexpected_process",
          detail: cmdline ?? "(cmdline unavailable)",
        });
        continue;
      }

      process.kill(pid, "SIGTERM");
      results.push({ serviceName, ok: true, pid, action: "sigterm" });
    } catch (err: unknown) {
      results.push({
        serviceName,
        ok: false,
        error: "restart_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.json({
    ok: true,
    requested: serviceNames,
    restarted: results.filter((r) => r.ok).map((r) => r.serviceName),
    results,
    note: serviceNames.includes("web-backend")
      ? "web-backend restart is always denied (it hosts this admin API/UI)."
      : undefined,
  });
});
export default router;
