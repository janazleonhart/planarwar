// worldcore/mud/commands/debug/serverBuffCommand.ts

import type { MudContext } from "../../MudContext";
import {
  addServerBuffPersisted,
  clearAllServerBuffsPersisted,
  formatServerBuffLine,
  listServerBuffs,
  removeServerBuffPersisted,
  syncServerBuffsToConnectedPlayers,
  clearServerBuffFromConnectedPlayers,
} from "../../../status/ServerBuffs";

function safeJsonParse(s: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false, error: "modifiersJson must be valid JSON" };
  }
}

export async function handleDebugServerBuff(
  ctx: MudContext,
  _char: any,
  args: string[],
): Promise<string> {
  const sub = String(args[0] ?? "").toLowerCase();
  const now = Date.now();

  if (!sub || sub === "help") {
    return [
      "[serverbuff] usage:",
      "  serverbuff list",
      "  serverbuff add <id> <durationSec|0> <modifiersJson> [tagsCsv]",
      "  serverbuff remove <id>",
      "  serverbuff clearall",
      "notes:",
      "  - durationSec=0 means 'until removed'",
      "  - modifiersJson is a StatusEffect modifier payload, e.g. '{\"damageDealtPct\":0.10}'",
      "examples:",
      "  serverbuff add redisum_boost 3600 '{\"damageDealtPct\":0.10}' event,donation",
      "  serverbuff add weekend_tank 0 '{\"damageTakenPct\":-0.10}' event",
    ].join("\n");
  }

  if (sub === "list") {
    const buffs = listServerBuffs(now);
    if (buffs.length === 0) return "[serverbuff] (none)";

    const lines = buffs.map((b) => `- ${formatServerBuffLine(b, now)}`);
    return ["[serverbuff] active:", ...lines].join("\n");
  }

  if (sub === "clearall") {
    // Clear from connected players first, then revoke/persist.
    for (const b of listServerBuffs(now)) {
      clearServerBuffFromConnectedPlayers((ctx as any)?.sessions, b.id);
    }

    const revoked = await clearAllServerBuffsPersisted("gm", now);
    return `[serverbuff] cleared all server buffs (revoked=${revoked}).`;
  }

  if (sub === "remove" || sub === "del" || sub === "delete") {
    const id = String(args[1] ?? "").trim();
    if (!id) return "[serverbuff] missing id";

    const existed = await removeServerBuffPersisted(id, "gm", now);
    const cleared = clearServerBuffFromConnectedPlayers((ctx as any)?.sessions, id);

    return existed
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

    const parsed = safeJsonParse(modifiersJson);
    if (!parsed.ok) return `[serverbuff] ${parsed.error}`;

    const tags = tagsCsv
      ? tagsCsv
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;

    const rec = await addServerBuffPersisted(
      id,
      {
        durationMs: Math.max(0, Math.floor(durationSec * 1000)),
        name: id,
        sourceKind: "environment",
        sourceId: "server",
        modifiers: parsed.value,
        tags,
        createdBy: "gm",
      },
      now,
    );

    // Apply immediately to connected players.
    try {
      syncServerBuffsToConnectedPlayers((ctx as any)?.entities, (ctx as any)?.sessions, now);
    } catch {
      // ignore
    }

    return `[serverbuff] added '${rec.id}' durationSec=${durationSec}`;
  }

  return "[serverbuff] unknown subcommand. try: serverbuff help";
}
