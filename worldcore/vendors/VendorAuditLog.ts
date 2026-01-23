// worldcore/vendors/VendorAuditLog.ts
//
// Vendor audit logging (v0).
//
// Design goals:
// - Never block gameplay if DB write fails.
// - Unit tests must not touch Postgres (WORLDCORE_TEST=1), but tests can still validate
//   the emitted audit events via capture mode.
// - Capture mode: PW_TEST_CAPTURE_VENDOR_AUDIT=1 collects events in memory for tests.

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

const log = Logger.scope("VENDOR_AUDIT");

export type VendorAuditAction = "buy" | "sell";

export type VendorAuditResult = "ok" | "deny" | "error";

export type VendorAuditEvent = {
  ts: string; // ISO
  shardId?: string | null;

  actorCharId?: string | null;
  actorCharName?: string | null;

  vendorId: string;
  vendorName?: string | null;

  action: VendorAuditAction;

  itemId?: string | null;
  quantity?: number | null;

  unitPriceGold?: number | null;
  totalGold?: number | null;

  goldBefore?: number | null;
  goldAfter?: number | null;

  result: VendorAuditResult;
  reason?: string | null;

  meta?: Record<string, unknown> | null;
};

const CAPTURE_ENABLED = () => String(process.env.PW_TEST_CAPTURE_VENDOR_AUDIT ?? "") === "1";
const UNIT_TEST_MODE = () => String(process.env.WORLDCORE_TEST ?? "") === "1";

let captured: VendorAuditEvent[] = [];

/** TEST ONLY: reset captured events. */
export function __resetCapturedVendorEvents(): void {
  captured = [];
}

/** TEST ONLY: get captured events. */
export function __getCapturedVendorEvents(): VendorAuditEvent[] {
  return [...captured];
}

function captureIfEnabled(ev: VendorAuditEvent): void {
  if (!CAPTURE_ENABLED()) return;
  captured.push(ev);
}

export async function logVendorEvent(ev: VendorAuditEvent): Promise<void> {
  captureIfEnabled(ev);

  // Never touch DB under unit tests.
  if (UNIT_TEST_MODE()) return;

  // Optional kill switch (for ops emergencies).
  if (String(process.env.PW_VENDOR_AUDIT_DB ?? "") === "0") return;

  try {
    await db.query(
      `
      INSERT INTO vendor_log (
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
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      )
      `,
      [
        ev.ts,
        ev.shardId ?? null,
        ev.actorCharId ?? null,
        ev.actorCharName ?? null,
        ev.vendorId,
        ev.vendorName ?? null,
        ev.action,
        ev.itemId ?? null,
        ev.quantity ?? null,
        ev.unitPriceGold ?? null,
        ev.totalGold ?? null,
        ev.goldBefore ?? null,
        ev.goldAfter ?? null,
        ev.result,
        ev.reason ?? null,
        ev.meta ? JSON.stringify(ev.meta) : null,
      ],
    );
  } catch (err) {
    // Best-effort only.
    log.warn("vendor audit insert failed", { err });
  }
}
