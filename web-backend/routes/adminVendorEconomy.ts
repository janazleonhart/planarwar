// web-backend/routes/adminVendorEconomy.ts
//
// Admin endpoints for editing vendor economy knobs (stock/restock/price multipliers).
// Backed by worldcore tables: vendors, vendor_items, vendor_item_economy, vendor_item_state.

import express from "express";
import { db } from "../../worldcore/db/Database";
import { describeVendorLaneSelection, deriveCityMudConsumers, deriveVendorEconomyRecommendation, deriveVendorGuardrailApplication, deriveVendorLanePolicy, deriveVendorRuntimeEffect, deriveVendorSupportPolicy, getVendorPreset, matchesVendorLaneSelection, normalizeVendorLaneSelection, normalizeVendorPresetKey, summarizeCityMudBridge, type CityMudVendorLane, type CityMudVendorPresetKey } from "../domain/cityMudBridge";
import { resolvePlayerAccess } from "./playerCityAccess";

export const adminVendorEconomyRouter = express.Router();

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return Math.floor(n);
}

function clampNum(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function toOptionalNumber(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string" && v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

type VendorRow = { id: string; name: string | null };
type VendorEconomyItemRow = {
  vendor_item_id: number;
  vendor_id: string;
  vendor_name: string | null;
  item_id: string;
  item_name: string | null;
  item_rarity: string | null;
  base_price_gold: number;
  stock: number | null;
  stock_max: number | null;
  last_restock_ts: string | null;
  restock_per_hour: number | null;
  restock_every_sec: number | null;
  restock_amount: number | null;
  price_min_mult: number | null;
  price_max_mult: number | null;
  bridge_lane_policy?: ReturnType<typeof deriveVendorLanePolicy> | null;
  bridge_recommendation?: ReturnType<typeof deriveVendorEconomyRecommendation> | null;
  bridge_runtime_effect?: ReturnType<typeof deriveVendorRuntimeEffect> | null;
};

async function getBridgeVendorPolicyOrNull(req: express.Request) {
  const access = await resolvePlayerAccess(req, { requireCity: false });
  if (access.ok === false) return null;
  const summary = summarizeCityMudBridge(access.access.playerState);
  const consumers = deriveCityMudConsumers(summary);
  return {
    summary,
    consumers,
    vendorPolicy: deriveVendorSupportPolicy(summary, consumers),
  };
}

adminVendorEconomyRouter.get("/vendors", async (_req, res) => {
  try {
    const r = (await db.query(`SELECT id, name FROM vendors ORDER BY id ASC`)) as { rows: VendorRow[] };
    res.json({ ok: true, vendors: r.rows ?? [] });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// GET /api/admin/vendor_economy/items?vendorId=...
// Lists vendor_items joined with economy + state.
adminVendorEconomyRouter.get("/items", async (req, res) => {
  try {
    const vendorId = typeof req.query.vendorId === "string" ? req.query.vendorId : null;
    if (!vendorId || !vendorId.trim()) {
      return res.status(400).json({ ok: false, error: "vendorId is required" });
    }

    const limit = clampInt(Number(req.query.limit ?? 500), 1, 5000);
    const offset = clampInt(Number(req.query.offset ?? 0), 0, 1_000_000);

    const params: any[] = [vendorId.trim(), limit, offset];

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM vendor_items WHERE vendor_id = $1`,
      [params[0]]
    );
    const total = Number(countRes.rows?.[0]?.count ?? 0);

    const r = (await db.query(
      `
      SELECT
        vi.id::int                   AS vendor_item_id,
        vi.vendor_id                 AS vendor_id,
        v.name                       AS vendor_name,
        vi.item_id                   AS item_id,
        it.name                      AS item_name,
        it.rarity                    AS item_rarity,
        vi.price_gold::int           AS base_price_gold,

        s.stock::int                 AS stock,
        s.last_restock_ts            AS last_restock_ts,

        e.stock_max::int             AS stock_max,
        e.restock_per_hour::int      AS restock_per_hour,
        e.restock_every_sec::int     AS restock_every_sec,
        e.restock_amount::int        AS restock_amount,
        e.price_min_mult::float      AS price_min_mult,
        e.price_max_mult::float      AS price_max_mult
      FROM vendor_items vi
      LEFT JOIN vendors v ON v.id = vi.vendor_id
      LEFT JOIN items it ON it.id = vi.item_id
      LEFT JOIN vendor_item_economy e ON e.vendor_item_id = vi.id
      LEFT JOIN vendor_item_state s ON s.vendor_item_id = vi.id
      WHERE vi.vendor_id = $1
      ORDER BY vi.id ASC
      LIMIT $2 OFFSET $3
      `,
      params
    )) as { rows: VendorEconomyItemRow[] };

    const bridge = await getBridgeVendorPolicyOrNull(req);
    const items = (r.rows ?? []).map((row) => {
      const lanePolicy = bridge
        ? deriveVendorLanePolicy(bridge.summary, bridge.consumers, bridge.vendorPolicy, {
            itemId: row.item_id,
            itemName: row.item_name,
            itemRarity: row.item_rarity,
          })
        : null;
      const bridgeRecommendation = lanePolicy
        ? deriveVendorEconomyRecommendation(
            {
              stockMax: row.stock_max,
              restockEverySec: row.restock_every_sec,
              restockAmount: row.restock_amount,
              priceMinMult: row.price_min_mult,
              priceMaxMult: row.price_max_mult,
            },
            lanePolicy,
          )
        : null;
      const bridgeRuntimeEffect = lanePolicy
        ? deriveVendorRuntimeEffect(
            {
              stock: row.stock,
              stockMax: row.stock_max,
              restockEverySec: row.restock_every_sec,
              restockAmount: row.restock_amount,
              priceMinMult: row.price_min_mult,
              priceMaxMult: row.price_max_mult,
            },
            lanePolicy,
          )
        : null;
      return {
        ...row,
        bridge_lane_policy: lanePolicy,
        bridge_recommendation: bridgeRecommendation,
        bridge_runtime_effect: bridgeRuntimeEffect,
      };
    });

    res.json({
      ok: true,
      vendorId: params[0],
      total,
      limit,
      offset,
      items,
      bridgeSummary: bridge?.summary ?? null,
      bridgeConsumers: bridge?.consumers ?? null,
      vendorPolicy: bridge?.vendorPolicy ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});



type BulkGuardedApplyBody = {
  vendorId?: string;
  vendorItemIds?: number[];
  laneFilters?: CityMudVendorLane[];
  presetKey?: CityMudVendorPresetKey;
  apply?: boolean;
  resetStock?: boolean;
};

adminVendorEconomyRouter.post("/bridge_runtime_guarded", async (req, res) => {
  try {
    const body = (req.body ?? {}) as BulkGuardedApplyBody;
    const vendorId = typeof body.vendorId === "string" ? body.vendorId.trim() : "";
    if (!vendorId) {
      return res.status(400).json({ ok: false, error: "vendorId is required" });
    }

    const rawIds = Array.isArray(body.vendorItemIds) ? body.vendorItemIds : [];
    const vendorItemIds = rawIds
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0)
      .slice(0, 500);
    const presetKey = normalizeVendorPresetKey(body.presetKey);
    const preset = presetKey ? getVendorPreset(presetKey) : null;
    const laneFilters = normalizeVendorLaneSelection(body.laneFilters);
    const effectiveLaneFilters = laneFilters.length > 0 ? laneFilters : (preset?.laneFilters ?? []);
    if (vendorItemIds.length === 0 && effectiveLaneFilters.length === 0) {
      return res.status(400).json({ ok: false, error: "vendorItemIds, laneFilters, or presetKey must include at least one valid selection" });
    }

    const apply = Boolean(body.apply);
    const resetStock = Boolean(body.resetStock);

    const bridge = await getBridgeVendorPolicyOrNull(req);
    if (!bridge) {
      return res.status(400).json({ ok: false, error: "bridge vendor policy unavailable for current context" });
    }

    const rows = (await db.query(
      `
      SELECT
        vi.id::int                   AS vendor_item_id,
        vi.vendor_id                 AS vendor_id,
        v.name                       AS vendor_name,
        vi.item_id                   AS item_id,
        it.name                      AS item_name,
        it.rarity                    AS item_rarity,
        vi.price_gold::int           AS base_price_gold,
        s.stock::int                 AS stock,
        s.last_restock_ts            AS last_restock_ts,
        e.stock_max::int             AS stock_max,
        e.restock_per_hour::int      AS restock_per_hour,
        e.restock_every_sec::int     AS restock_every_sec,
        e.restock_amount::int        AS restock_amount,
        e.price_min_mult::float      AS price_min_mult,
        e.price_max_mult::float      AS price_max_mult
      FROM vendor_items vi
      LEFT JOIN vendors v ON v.id = vi.vendor_id
      LEFT JOIN items it ON it.id = vi.item_id
      LEFT JOIN vendor_item_economy e ON e.vendor_item_id = vi.id
      LEFT JOIN vendor_item_state s ON s.vendor_item_id = vi.id
      WHERE vi.vendor_id = $1
        AND ($2::int[] IS NULL OR cardinality($2::int[]) = 0 OR vi.id = ANY($2::int[]))
      ORDER BY vi.id ASC
      LIMIT 1000
      `,
      [vendorId, vendorItemIds.length > 0 ? vendorItemIds : null]
    )) as { rows: VendorEconomyItemRow[] };

    const results: any[] = [];
    let appliedCount = 0;
    for (const row of rows.rows ?? []) {
      const lanePolicy = deriveVendorLanePolicy(bridge.summary, bridge.consumers, bridge.vendorPolicy, {
        itemId: row.item_id,
        itemName: row.item_name,
        itemRarity: row.item_rarity,
      });
      if (!matchesVendorLaneSelection(lanePolicy, effectiveLaneFilters)) {
        continue;
      }
      const runtimeEffect = deriveVendorRuntimeEffect({
        stock: row.stock,
        stockMax: row.stock_max,
        restockEverySec: row.restock_every_sec,
        restockAmount: row.restock_amount,
        priceMinMult: row.price_min_mult,
        priceMaxMult: row.price_max_mult,
      }, lanePolicy);
      const guardrail = deriveVendorGuardrailApplication({
        stockMax: row.stock_max,
        restockEverySec: row.restock_every_sec,
        restockAmount: row.restock_amount,
        priceMinMult: row.price_min_mult,
        priceMaxMult: row.price_max_mult,
      }, runtimeEffect);

      let applied = false;
      if (apply && guardrail.allowed) {
        await db.query(
          `
          INSERT INTO vendor_item_economy (
            vendor_item_id, stock_max, restock_per_hour, restock_every_sec, restock_amount, price_min_mult, price_max_mult
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (vendor_item_id) DO UPDATE SET
            stock_max = EXCLUDED.stock_max,
            restock_per_hour = EXCLUDED.restock_per_hour,
            restock_every_sec = EXCLUDED.restock_every_sec,
            restock_amount = EXCLUDED.restock_amount,
            price_min_mult = EXCLUDED.price_min_mult,
            price_max_mult = EXCLUDED.price_max_mult
          `,
          [row.vendor_item_id, guardrail.stockMax, guardrail.restockPerHour, guardrail.restockEverySec, guardrail.restockAmount, guardrail.priceMinMult, guardrail.priceMaxMult]
        );
        if (resetStock) {
          const newStock = guardrail.stockMax > 0 ? guardrail.stockMax : 0;
          await db.query(
            `
            INSERT INTO vendor_item_state (vendor_item_id, stock, last_restock_ts)
            VALUES ($1, $2, NOW())
            ON CONFLICT (vendor_item_id) DO UPDATE SET
              stock = EXCLUDED.stock,
              last_restock_ts = EXCLUDED.last_restock_ts
            `,
            [row.vendor_item_id, newStock]
          );
        }
        applied = true;
        appliedCount += 1;
      }

      results.push({
        vendor_item_id: row.vendor_item_id,
        item_id: row.item_id,
        item_name: row.item_name,
        runtimeEffect,
        guardrail,
        applied,
      });
    }

    return res.json({
      ok: true,
      vendorId,
      apply,
      resetStock,
      requestedCount: vendorItemIds.length,
      matchedCount: results.length,
      appliedCount,
      bridgeSummary: bridge.summary,
      bridgeConsumers: bridge.consumers,
      vendorPolicy: bridge.vendorPolicy,
      laneFiltersApplied: effectiveLaneFilters,
      presetApplied: preset,
      selectionLabel: preset?.label ?? describeVendorLaneSelection(effectiveLaneFilters),
      results,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});
type UpdateVendorEconomyBody = {
  stockMax?: number | null;
  restockEverySec?: number | null;
  restockAmount?: number | null;
  priceMinMult?: number | null;
  priceMaxMult?: number | null;
  resetStock?: boolean; // optional: reset state.stock to stockMax
};

// POST /api/admin/vendor_economy/items/:vendorItemId
adminVendorEconomyRouter.post("/items/:vendorItemId", async (req, res) => {
  try {
    const vendorItemId = Number(req.params.vendorItemId);
    if (!Number.isFinite(vendorItemId) || vendorItemId <= 0) {
      return res.status(400).json({ ok: false, error: "invalid vendorItemId" });
    }

    const body = (req.body ?? {}) as UpdateVendorEconomyBody;

    // Normalize inputs (undefined means "leave as-is" when row exists, but our upsert sets defaults).
    // We clamp aggressively so admin typos don't brick the economy.
    const stockMaxIn = toOptionalNumber(body.stockMax);
    const restockEverySecIn = toOptionalNumber(body.restockEverySec);
    const restockAmountIn = toOptionalNumber(body.restockAmount);
    const priceMinMultIn = toOptionalNumber(body.priceMinMult);
    const priceMaxMultIn = toOptionalNumber(body.priceMaxMult);
    const resetStock = Boolean(body.resetStock);

    // Clamp values:
    // - stockMax <= 0 means infinite (we store 0)
    // - restockEverySec <= 0 disables cadence (store 0)
    // - restockAmount <= 0 disables cadence (store 0)
    // - price multipliers clamped to [0.05..10] (and auto-ordered)
    const stockMax = stockMaxIn === undefined ? 50 : clampInt(stockMaxIn, 0, 1_000_000);
    const restockEverySec = restockEverySecIn === undefined ? 0 : clampInt(restockEverySecIn, 0, 31_536_000); // up to 1y
    const restockAmount = restockAmountIn === undefined ? 0 : clampInt(restockAmountIn, 0, 1_000_000);

    let minM = priceMinMultIn === undefined ? 0.85 : clampNum(priceMinMultIn, 0.05, 10);
    let maxM = priceMaxMultIn === undefined ? 1.5 : clampNum(priceMaxMultIn, 0.05, 10);
    const lo = Math.min(minM, maxM);
    const hi = Math.max(minM, maxM);
    minM = lo;
    maxM = hi;

    // Keep legacy restock_per_hour roughly consistent for older code paths.
    const derivedPerHour =
      restockEverySec > 0 && restockAmount > 0
        ? clampInt(Math.ceil((restockAmount * 3600) / restockEverySec), 0, 1_000_000)
        : 0;

    await db.query(
      `
      INSERT INTO vendor_item_economy (
        vendor_item_id,
        stock_max,
        restock_per_hour,
        restock_every_sec,
        restock_amount,
        price_min_mult,
        price_max_mult
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (vendor_item_id) DO UPDATE SET
        stock_max = EXCLUDED.stock_max,
        restock_per_hour = EXCLUDED.restock_per_hour,
        restock_every_sec = EXCLUDED.restock_every_sec,
        restock_amount = EXCLUDED.restock_amount,
        price_min_mult = EXCLUDED.price_min_mult,
        price_max_mult = EXCLUDED.price_max_mult
      `,
      [vendorItemId, stockMax, derivedPerHour, restockEverySec, restockAmount, minM, maxM]
    );

    if (resetStock) {
      // If stock_max is 0 (infinite), we keep state at 0.
      const newStock = stockMax > 0 ? stockMax : 0;
      await db.query(
        `
        INSERT INTO vendor_item_state (vendor_item_id, stock, last_restock_ts)
        VALUES ($1, $2, NOW())
        ON CONFLICT (vendor_item_id) DO UPDATE SET
          stock = EXCLUDED.stock,
          last_restock_ts = EXCLUDED.last_restock_ts
        `,
        [vendorItemId, newStock]
      );
    }

    res.json({
      ok: true,
      vendorItemId,
      applied: {
        stockMax,
        restockEverySec,
        restockAmount,
        priceMinMult: minM,
        priceMaxMult: maxM,
        restockPerHour: derivedPerHour,
        resetStock,
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});
