// worldcore/vendors/VendorAuditLog.ts
//
// Vendor audit logging (v0).
//
// Design goals:
// - Never block gameplay if DB write fails.
// - Unit tests must not touch Postgres (WORLDCORE_TEST=1), but tests can still validate
//   the emitted audit events via capture mode.
// - Capture mode: PW_TEST_CAPTURE_VENDOR_AUDIT=1 collects events in memory for tests.
//
// Step 3 hardening:
// - Ensure audit events carry stable metadata:
//     meta.schemaVersion = 1
//     meta.rule          = <stable rule id>
// - Ensure non-ok audit events have a stable reason code (never empty).
// - Never introduce new audit emissions; this module only normalizes what callers send.

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
  /** Stable reason code for deny/error (e.g. out_of_stock, bags_full, integrity_failed). */
  reason?: string | null;

  /** Arbitrary metadata for ops/debugging. Persisted as JSON. */
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normReason(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}

function defaultRuleFor(ev: VendorAuditEvent): string {
  // Stable fallback rule id if caller didn't provide one.
  // Prefer explicit rule assignment in command layer for critical events.
  return `vendor.${ev.action}.${ev.result}`;
}

function normalizeEvent(input: VendorAuditEvent): VendorAuditEvent {
  const metaIn = isPlainObject(input.meta) ? input.meta : {};

  const meta = {
    schemaVersion: 1,
    rule: typeof metaIn.rule === "string" && metaIn.rule.trim() ? metaIn.rule : defaultRuleFor(input),
    ...metaIn,
  } as Record<string, unknown>;

  // For deny/error, ensure reason is never empty (stable code).
  let reason = normReason(input.reason);
  if (input.result !== "ok" && !reason) reason = "unspecified";

  return {
    ...input,
    reason,
    meta,
  };
}

export async function logVendorEvent(ev: VendorAuditEvent): Promise<void> {
  const normalized = normalizeEvent(ev);

  captureIfEnabled(normalized);

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
        normalized.ts,
        normalized.shardId ?? null,
        normalized.actorCharId ?? null,
        normalized.actorCharName ?? null,
        normalized.vendorId,
        normalized.vendorName ?? null,
        normalized.action,
        normalized.itemId ?? null,
        normalized.quantity ?? null,
        normalized.unitPriceGold ?? null,
        normalized.totalGold ?? null,
        normalized.goldBefore ?? null,
        normalized.goldAfter ?? null,
        normalized.result,
        normalized.reason ?? null,
        normalized.meta ? JSON.stringify(normalized.meta) : null,
      ],
    );
  } catch (err) {
    // Best-effort only.
    log.warn("vendor audit insert failed", { err });
  }
}
