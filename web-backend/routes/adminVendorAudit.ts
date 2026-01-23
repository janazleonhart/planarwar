// web-backend/routes/adminVendorAudit.ts
//
// Admin Vendor Audit API
// - GET /api/admin/vendor_audit            -> JSON (paged)
// - GET /api/admin/vendor_audit/csv        -> CSV (streaming, all matching filters)
//
// Notes:
// - CSV endpoint streams rows in chunks to support very large exports without browser memory blowups.
// - Uses parameterized queries throughout.
// - Ordering is newest-first (ts DESC) to match the viewer.

import express from "express";
import { db } from "../../worldcore/db/Database";

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return Math.floor(n);
}

type AuditFilters = {
  vendorId: string | null;
  actorCharId: string | null;
  actorCharName: string | null;
  action: string | null;
  result: string | null;
  itemId: string | null;
  since: string | null;
  until: string | null;
};

function readFilters(req: express.Request): AuditFilters {
  return {
    vendorId: typeof req.query.vendorId === "string" ? req.query.vendorId : null,
    actorCharId: typeof req.query.actorCharId === "string" ? req.query.actorCharId : null,
    actorCharName: typeof req.query.actorCharName === "string" ? req.query.actorCharName : null,
    action: typeof req.query.action === "string" ? req.query.action : null,
    result: typeof req.query.result === "string" ? req.query.result : null,
    itemId: typeof req.query.itemId === "string" ? req.query.itemId : null,
    since: typeof req.query.since === "string" ? req.query.since : null,
    until: typeof req.query.until === "string" ? req.query.until : null,
  };
}

function buildWhere(filters: AuditFilters): { whereSql: string; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];

  const add = (sqlPrefix: string, val: any) => {
    params.push(val);
    where.push(`${sqlPrefix} $${params.length}`);
  };

  if (filters.vendorId) add("vendor_id =", filters.vendorId);
  if (filters.actorCharId) add("actor_char_id =", filters.actorCharId);
  if (filters.actorCharName) add("actor_char_name ILIKE", `%${filters.actorCharName}%`);
  if (filters.action) add("action =", filters.action);
  if (filters.result) add("result =", filters.result);
  if (filters.itemId) add("item_id =", filters.itemId);
  if (filters.since) add("ts >=", filters.since);
  if (filters.until) add("ts <=", filters.until);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { whereSql, params };
}

function csvEscape(value: any): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const adminVendorAuditRouter = express.Router();

// JSON (paged)
adminVendorAuditRouter.get("/", async (req, res) => {
  try {
    const limit = clampInt(Number(req.query.limit ?? 200), 1, 1000);
    const offset = clampInt(Number(req.query.offset ?? 0), 0, 5_000_000);

    const filters = readFilters(req);
    const { whereSql, params } = buildWhere(filters);

    const countRes = await db.query(`SELECT COUNT(*)::int AS count FROM vendor_log ${whereSql}`, params);
    const total = Number(countRes.rows?.[0]?.count ?? 0);

    const dataParams = [...params, limit, offset];
    const dataRes = await db.query(
      `
      SELECT
        ts,
        shard_id,
        actor_char_id,
        actor_char_name,
        vendor_id,
        vendor_name,
        action,
        item_id,
        quantity,
        unit_price_gold,
        total_gold,
        gold_before,
        gold_after,
        result,
        reason,
        meta
      FROM vendor_log
      ${whereSql}
      ORDER BY ts DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
      `,
      dataParams
    );

    res.json({
      ok: true,
      total,
      limit,
      offset,
      rows: dataRes.rows ?? [],
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// CSV (streaming, all matching filters)
adminVendorAuditRouter.get("/csv", async (req, res) => {
  try {
    const filters = readFilters(req);
    const { whereSql, params } = buildWhere(filters);

    // Safety rail: large enough for real exports, bounded enough to prevent “accidental planet-scale download”.
    const maxRows = clampInt(Number(req.query.maxRows ?? 2_000_000), 1, 5_000_000);
    const chunk = clampInt(Number(req.query.chunk ?? 1000), 1, 2000);

    const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
    const filename = `vendor_audit_${stamp}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    // Excel-friendly UTF-8 BOM (avoids mojibake for non-ASCII names).
    res.write("\ufeff");

    const headers = [
      "ts",
      "shard_id",
      "actor_char_id",
      "actor_char_name",
      "vendor_id",
      "vendor_name",
      "action",
      "item_id",
      "quantity",
      "unit_price_gold",
      "total_gold",
      "gold_before",
      "gold_after",
      "result",
      "reason",
      "meta_json",
    ];
    res.write(headers.join(",") + "\r\n");

    let aborted = false;
    req.on("close", () => {
      aborted = true;
    });

    let offset = 0;
    let written = 0;

    while (!aborted && written < maxRows) {
      const pageLimit = Math.min(chunk, maxRows - written);
      const dataParams = [...params, pageLimit, offset];

      const dataRes = await db.query(
        `
        SELECT
          ts,
          shard_id,
          actor_char_id,
          actor_char_name,
          vendor_id,
          vendor_name,
          action,
          item_id,
          quantity,
          unit_price_gold,
          total_gold,
          gold_before,
          gold_after,
          result,
          reason,
          meta
        FROM vendor_log
        ${whereSql}
        ORDER BY ts DESC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
        `,
        dataParams
      );

      const rows = dataRes.rows ?? [];
      if (rows.length === 0) break;

      for (const r of rows) {
        if (aborted) break;

        const metaJson = r.meta == null ? "" : JSON.stringify(r.meta);
        const cols = [
          r.ts,
          r.shard_id ?? "",
          r.actor_char_id ?? "",
          r.actor_char_name ?? "",
          r.vendor_id ?? "",
          r.vendor_name ?? "",
          r.action ?? "",
          r.item_id ?? "",
          r.quantity ?? "",
          r.unit_price_gold ?? "",
          r.total_gold ?? "",
          r.gold_before ?? "",
          r.gold_after ?? "",
          r.result ?? "",
          r.reason ?? "",
          metaJson,
        ].map(csvEscape);

        res.write(cols.join(",") + "\r\n");
        written += 1;
        if (written >= maxRows) break;
      }

      offset += rows.length;

      // If server returned fewer rows than requested, we hit the end.
      if (rows.length < pageLimit) break;
    }

    res.end();
  } catch (err: any) {
    try {
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: err?.message ?? String(err) });
      } else {
        res.end();
      }
    } catch {
      // ignore
    }
  }
});
