// web-backend/routes/adminVendorAudit.ts

import express from "express";
import { db } from "../../worldcore/db/Database";

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return Math.floor(n);
}

export const adminVendorAuditRouter = express.Router();

adminVendorAuditRouter.get("/", async (req, res) => {
  try {
    const limit = clampInt(Number(req.query.limit ?? 200), 1, 1000);
    const offset = clampInt(Number(req.query.offset ?? 0), 0, 1_000_000);

    const vendorId = typeof req.query.vendorId === "string" ? req.query.vendorId : null;
    const actorCharId = typeof req.query.actorCharId === "string" ? req.query.actorCharId : null;
    const actorCharName = typeof req.query.actorCharName === "string" ? req.query.actorCharName : null;
    const action = typeof req.query.action === "string" ? req.query.action : null;
    const resultFilter = typeof req.query.result === "string" ? req.query.result : null;
    const itemId = typeof req.query.itemId === "string" ? req.query.itemId : null;
    const since = typeof req.query.since === "string" ? req.query.since : null;
    const until = typeof req.query.until === "string" ? req.query.until : null;

    const where: string[] = [];
    const params: any[] = [];

    const add = (sql: string, val: any) => {
      params.push(val);
      where.push(`${sql} $${params.length}`);
    };

    if (vendorId) add("vendor_id =", vendorId);
    if (actorCharId) add("actor_char_id =", actorCharId);
    if (actorCharName) add("actor_char_name ILIKE", `%${actorCharName}%`);
    if (action) add("action =", action);
    if (resultFilter) add("result =", resultFilter);
    if (itemId) add("item_id =", itemId);
    if (since) add("ts >=", since);
    if (until) add("ts <=", until);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM vendor_log ${whereSql}`,
      params
    );
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
