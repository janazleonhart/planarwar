// worldcore/mud/commands/debug/serverEventCommand.ts

import type { MudContext } from "../../MudContext";
import { PostgresServerEventService } from "../../../status/PostgresServerEventService";
import { syncServerEventsToPersistence, resetServerEventsRuntimeCache } from "../../../status/ServerEvents";

function safeJsonParse(s: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

function parseIsoToMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function usage(): string {
  return [
    "[serverevent] Commands:",
    "  serverevent list",
    "  serverevent add <id> <name> <startsIso> <endsIso|null>",
    "  serverevent enable <id>",
    "  serverevent disable <id>",
    "  serverevent del <id>",
    "  serverevent effect_add <eventId> <kind> <payloadJson>",
    "  serverevent effect_del <effectIdNumber>",
    "  serverevent reload",
    "",
    "Effect kinds v0:",
    "  grant_server_buff payload: { id, name?, modifiers?, tags?, maxStacks?, initialStacks?, effectId? }",
    "  set_server_kv payload: { key, value }  (writes server_kv key event.<eventId>.<key>)",
    "  broadcast_message payload: { text, oncePerActivation? }",
  ].join("\n");
}

export async function handleDebugServerEvent(
  _ctx: MudContext,
  _char: any,
  args: string[],
): Promise<string> {
  const sub = String(args[0] ?? "").toLowerCase();
  const svc = new PostgresServerEventService();

  if (!sub || sub === "help") return usage();

  if (sub === "list") {
    const rows = await svc.listAll();
    if (!rows.length) return "[serverevent] none";
    return rows
      .map((r) => {
        const ends = r.ends_at ? r.ends_at : "null";
        return `[serverevent] ${r.id} enabled=${r.enabled} starts=${r.starts_at} ends=${ends} name="${r.name}"`;
      })
      .join("\n");
  }

  if (sub === "add") {
    const id = String(args[1] ?? "").trim();
    const name = String(args[2] ?? "").trim();
    const startsIso = String(args[3] ?? "").trim();
    const endsRaw = args[4];
    const endsIso = endsRaw === undefined || String(endsRaw).toLowerCase() === "null" ? null : String(endsRaw).trim();

    if (!id || !name || !startsIso) return "[serverevent] missing args.\n" + usage();

    const startsAtMs = parseIsoToMs(startsIso);
    if (startsAtMs == null) return `[serverevent] invalid startsIso: ${startsIso}`;

    let endsAtMs: number | null | undefined = undefined;
    if (endsIso === null) {
      endsAtMs = null;
    } else {
      const ms = parseIsoToMs(endsIso);
      if (ms == null) return `[serverevent] invalid endsIso: ${endsIso}`;
      endsAtMs = ms;
    }

    await svc.upsertEvent({ id, name, enabled: true, startsAtMs, endsAtMs });
    return `[serverevent] added/updated ${id}`;
  }

  if (sub === "enable" || sub === "disable") {
    const id = String(args[1] ?? "").trim();
    if (!id) return "[serverevent] missing id";
    await svc.setEnabled(id, sub === "enable");
    return `[serverevent] ${sub}d ${id}`;
  }

  if (sub === "del" || sub === "delete") {
    const id = String(args[1] ?? "").trim();
    if (!id) return "[serverevent] missing id";
    await svc.deleteEvent(id);
    return `[serverevent] deleted ${id}`;
  }

  if (sub === "effect_add") {
    const eventId = String(args[1] ?? "").trim();
    const kind = String(args[2] ?? "").trim();
    const payloadStr = String(args[3] ?? "").trim();

    if (!eventId || !kind || !payloadStr) return "[serverevent] missing args.\n" + usage();
    const parsed = safeJsonParse(payloadStr);
    if (!parsed.ok) return `[serverevent] invalid JSON: ${parsed.error}`;

    const id = await svc.addEffect({ eventId, effectKind: kind, payload: parsed.value });
    if (id == null) return `[serverevent] effect add failed for event=${eventId}`;
    return `[serverevent] effect added id=${id} on ${eventId}`;
  }

  if (sub === "effect_del") {
    const raw = String(args[1] ?? "").trim();
    if (!raw) return "[serverevent] missing effectIdNumber";
    const id = Number(raw);
    if (!Number.isFinite(id)) return `[serverevent] invalid effectIdNumber: ${raw}`;
    await svc.deleteEffect(id);
    return `[serverevent] effect deleted ${id}`;
  }

  if (sub === "reload") {
    resetServerEventsRuntimeCache();
    const msg = await syncServerEventsToPersistence(Date.now());
    return `[serverevent] ${msg}`;
  }

  return "[serverevent] unknown subcommand.\n" + usage();
}
