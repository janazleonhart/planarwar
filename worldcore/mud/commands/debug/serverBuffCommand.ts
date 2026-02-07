// worldcore/mud/commands/debug/serverBuffCommand.ts

import type { MudContext } from "../../MudContext";
import { addServerBuff, clearAllServerBuffs, listServerBuffs, removeServerBuff, syncServerBuffsToConnectedPlayers, clearServerBuffFromConnectedPlayers } from "../../../status/ServerBuffs";

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "?";
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

export async function handleDebugServerBuff(ctx: MudContext, _char: any, args: string[]): Promise<string> {
  const sub = String(args[0] ?? "").toLowerCase();
  const now = Date.now();

  if (!sub || sub === "help") {
    return [
      "[serverbuff] usage:",
      "  serverbuff list",
      "  serverbuff add <id> <durationSec|0> <modifiersJson> [tagsCsv]",
      "  serverbuff remove <id>",
      "  serverbuff clearall",
      "examples:",
      "  serverbuff add redisum_boost 3600 '{\"damageDealtPct\":0.10}' event,donation",
      "  serverbuff add weekend_tank 0 '{\"damageTakenPct\":-0.10}' event",
    ].join("\n");
  }

  if (sub === "list") {
    const buffs = listServerBuffs(now);
    if (buffs.length === 0) return "[serverbuff] (none)";
    const lines = buffs.map((b) => {
      const rem = b.expiresAtMs === Number.MAX_SAFE_INTEGER ? "until removed" : fmtMs(b.expiresAtMs - now);
      const tags = (b.tags ?? []).join(",");
      return `- ${b.id} (${rem}) tags=[${tags}]`;
    });
    return ["[serverbuff] active:", ...lines].join("\n");
  }

  if (sub === "clearall") {
    // Clear from connected players first, then drop memory.
    for (const b of listServerBuffs(now)) {
      clearServerBuffFromConnectedPlayers((ctx as any)?.sessions, b.id);
    }
    clearAllServerBuffs();
    return "[serverbuff] cleared all server buffs.";
  }

  if (sub === "remove" || sub === "del" || sub === "delete") {
    const id = String(args[1] ?? "").trim();
    if (!id) return "[serverbuff] missing id";
    const ok = removeServerBuff(id);
    const cleared = clearServerBuffFromConnectedPlayers((ctx as any)?.sessions, id);
    return ok
      ? `[serverbuff] removed '${id}' (clearedFromPlayers=${cleared})`
      : `[serverbuff] no such buff '${id}' (clearedFromPlayers=${cleared})`;
  }

  if (sub === "add") {
    const id = String(args[1] ?? "").trim();
    const durationSec = Number(args[2] ?? "0");
    const modifiersJson = String(args[3] ?? "").trim();
    const tagsCsv = String(args[4] ?? "").trim();

    if (!id) return "[serverbuff] missing id";
    if (!Number.isFinite(durationSec)) return "[serverbuff] durationSec must be a number";
    if (!modifiersJson) return "[serverbuff] missing modifiersJson";

    let modifiers: any;
    try {
      modifiers = JSON.parse(modifiersJson);
    } catch {
      return "[serverbuff] modifiersJson must be valid JSON";
    }

    const tags = tagsCsv ? tagsCsv.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

    addServerBuff(
      id,
      {
        durationMs: Math.max(0, Math.floor(durationSec * 1000)),
        name: id,
        sourceKind: "environment",
        sourceId: "server",
        modifiers,
        tags,
      },
      now,
    );

    // Apply immediately to connected players.
    try {
      syncServerBuffsToConnectedPlayers((ctx as any)?.entities, (ctx as any)?.sessions, now);
    } catch {
      // ignore
    }

    return `[serverbuff] added '${id}' durationSec=${durationSec}`;
  }

  return "[serverbuff] unknown subcommand. try: serverbuff help";
}
