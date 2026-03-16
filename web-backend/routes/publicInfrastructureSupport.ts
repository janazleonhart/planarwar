//web-backend/routes/publicInfrastructureSupport.ts

import type { PlayerState, Resources } from "../gameState";
import {
  applyLevyToResources,
  canAffordLevy,
  quotePublicServiceUsage,
  recordPublicServiceReceipt,
  type InfrastructureMode,
  type PublicServiceKind,
  type PublicServiceQuote,
} from "../domain/publicInfrastructure";
import { applyCityRuntimeSnapshot, buildCityRuntimeSnapshot } from "../gameState/cityRuntimeSnapshot";

export function cloneResources(resources: Resources): Resources {
  return { ...resources };
}

export function diffSpentResources(before: Resources, after: Resources): Partial<Resources> {
  const spent: Partial<Resources> = {};
  for (const key of ["food", "materials", "wealth", "mana", "knowledge", "unity"] as const) {
    const delta = Number(before[key] ?? 0) - Number(after[key] ?? 0);
    if (delta > 0) {
      spent[key] = delta;
    }
  }
  return spent;
}

function pushInfrastructureEvent(ps: PlayerState, message: string): void {
  ps.eventLog.push({
    id: `evt_pubsvc_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    timestamp: new Date().toISOString(),
    kind: "city_stress_change",
    message,
  });
  if (ps.eventLog.length > 100) {
    ps.eventLog.splice(0, ps.eventLog.length - 100);
  }
}

export function applyPublicInfrastructureUsage(
  ps: PlayerState,
  service: PublicServiceKind,
  mode: InfrastructureMode,
  baseCosts: Partial<Resources>,
  now = new Date()
): { ok: true; quote: PublicServiceQuote } | { ok: false; error: string } {
  const quote = quotePublicServiceUsage(ps, service, baseCosts, mode);
  if (mode === "private_city") {
    return { ok: true, quote };
  }

  if (!canAffordLevy(ps.resources, quote.levy)) {
    return {
      ok: false,
      error: `NPC public service levy could not be paid. ${quote.note}`,
    };
  }

  applyLevyToResources(ps.resources, quote.levy);
  const receipt = recordPublicServiceReceipt(ps, quote, now);
  pushInfrastructureEvent(
    ps,
    `Public infrastructure used for ${receipt.service.replace(/_/g, " ")}: ${receipt.note}`
  );
  return { ok: true, quote };
}

export function withInfrastructureRollback<T>(
  ps: PlayerState,
  action: () => T,
  verify: (value: T) => { ok: true } | { ok: false; error: string }
): { ok: true; value: T } | { ok: false; error: string } {
  const snapshot = buildCityRuntimeSnapshot(ps);
  const value = action();
  const verdict = verify(value);
  if (verdict.ok === false) {
    applyCityRuntimeSnapshot(ps, snapshot);
    return { ok: false, error: verdict.error };
  }
  return { ok: true, value };
}
