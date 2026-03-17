//web-backend/routes/publicInfrastructureSupport.ts

import type { PlayerState, Resources } from "../gameState";
import {
  applyLevyToResources,
  canAffordLevy,
  quotePublicServiceUsage,
  recordPublicServiceReceipt,
  summarizePublicInfrastructure,
  type InfrastructureMode,
  type PublicServiceKind,
  type PublicServiceQuote,
  type PublicInfrastructureReceipt,
  type PublicInfrastructureSummary,
} from "../domain/publicInfrastructure";
import { applyCityRuntimeSnapshot, buildCityRuntimeSnapshot } from "../gameState/cityRuntimeSnapshot";

export interface AppliedPublicInfrastructureUsage {
  quote: PublicServiceQuote;
  receipt: PublicInfrastructureReceipt | null;
  summary: PublicInfrastructureSummary;
  queueAppliedMinutes: number;
  eventMessage: string;
}

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

function buildInfrastructureEventMessage(
  service: PublicServiceKind,
  mode: InfrastructureMode,
  quote: PublicServiceQuote,
  summary: PublicInfrastructureSummary
): string {
  if (mode === "private_city") {
    return `Private infrastructure handled ${service.replace(/_/g, " ")}. ${summary.note}`;
  }

  const levyBits = Object.entries(quote.levy)
    .filter(([, amount]) => Number(amount ?? 0) > 0)
    .map(([key, amount]) => `${key} ${amount}`)
    .join(", ");
  const pressureBits = quote.pressureSources
    .filter((source) => source.score > 0)
    .slice(0, 2)
    .map((source) => source.label.toLowerCase())
    .join(", ");

  const levyText = levyBits ? ` Levy: ${levyBits}.` : "";
  const queueText = quote.queueMinutes > 0 ? ` Queue delay: ${quote.queueMinutes}m.` : "";
  const pressureText = pressureBits ? ` Pressure inputs: ${pressureBits}.` : "";
  return `Public infrastructure handled ${service.replace(/_/g, " ")}. ${quote.note}${levyText}${queueText}${pressureText}`;
}

export function applyPublicInfrastructureUsage(
  ps: PlayerState,
  service: PublicServiceKind,
  mode: InfrastructureMode,
  baseCosts: Partial<Resources>,
  now = new Date()
): { ok: true; usage: AppliedPublicInfrastructureUsage } | { ok: false; error: string } {
  const quote = quotePublicServiceUsage(ps, service, baseCosts, mode);
  const summary = summarizePublicInfrastructure(ps);
  if (mode === "private_city") {
    return {
      ok: true,
      usage: {
        quote,
        receipt: null,
        summary,
        queueAppliedMinutes: 0,
        eventMessage: buildInfrastructureEventMessage(service, mode, quote, summary),
      },
    };
  }

  if (!canAffordLevy(ps.resources, quote.levy)) {
    return {
      ok: false,
      error: `NPC public service levy could not be paid. ${quote.note}`,
    };
  }

  applyLevyToResources(ps.resources, quote.levy);
  const receipt = recordPublicServiceReceipt(ps, quote, now);
  const postSummary = summarizePublicInfrastructure(ps);
  const eventMessage = buildInfrastructureEventMessage(service, mode, quote, postSummary);
  pushInfrastructureEvent(ps, eventMessage);
  return {
    ok: true,
    usage: {
      quote,
      receipt,
      summary: postSummary,
      queueAppliedMinutes: quote.queueMinutes,
      eventMessage,
    },
  };
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
