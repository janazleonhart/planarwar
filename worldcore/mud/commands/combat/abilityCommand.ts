// worldcore/mud/commands/combat/abilityCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { MudCommandInput } from "../types";
import { handleAbilityCommand } from "../../MudAbilities";
import { parseHandleToken } from "../../handles/NearbyHandles";

/**
 * MUD wrapper for the core ability handler.
 *
 * Supports:
 *   ability <idOrName>
 *   ability <idOrName> <target>
 *   ability <multi word name> <target>
 *
 * If the last arg looks like a target token (nearby handle like "rat.1"
 * OR an entity-id-like handle that ends with ".<digits>", e.g. "npc.rat.1"),
 * it is treated as the target and the rest is joined as the ability name.
 */
export async function handleAbilityMudCommand(
  ctx: MudContext,
  char: CharacterState,
  input: MudCommandInput,
): Promise<string> {
  if (!input.args || input.args.length === 0) {
    return "Usage: ability <name|id> [target]";
  }

  const args = input.args;

  // Parsing rules (robust, player-friendly):
  // - If one arg: treat as ability name/id.
  // - If >=2 args: prefer treating the LAST token as the target and the rest as ability name.
  //   This makes `ability power_strike dummy` work (single-token targets), while still
  //   supporting multi-word ability names like `ability Rising Courage dummy`.
  // - If that parse yields an "Unknown ability" response, fall back to interpreting ALL args
  //   as the ability name with no explicit target.
  let abilityName: string;
  let targetRaw: string | undefined;

  if (args.length === 1) {
    abilityName = String(args[0] ?? "").trim();
    targetRaw = undefined;
  } else {
    const last = String(args[args.length - 1] ?? "").trim();
    const nameCandidate = args.slice(0, -1).join(" ").trim();

    abilityName = nameCandidate;
    targetRaw = last;

    // Preserve the old "handleish" target detection as a hint (keeps intent readable in logs),
    // but do not REQUIRE it. Plain tokens like "dummy" are valid targets in this game.
    const parsed = parseHandleToken(last);
    const looksLikeNearbyHandle = !!(parsed && typeof parsed.idx === "number");
    const looksLikeHandleishId = /\.[0-9]+$/.test(last) && !/\s/.test(last);
    void looksLikeNearbyHandle;
    void looksLikeHandleishId;
  }

  if (!abilityName) return "Usage: ability <name|id> [target]";

  const run = (name: string, target?: string) =>
    handleAbilityCommand(ctx, char, name, target && target.trim() ? target.trim() : undefined);

  if (!targetRaw) return run(abilityName, undefined);

  const primary = await run(abilityName, targetRaw);
  // If we mis-parsed a multi-word ability name with no explicit target, the primary attempt will
  // likely return "Unknown ability '... <last>'". In that case, fall back to a no-target parse.
  if (typeof primary === "string" && /^\[world\]\s+Unknown\s+ability\b/i.test(primary)) {
    const fallbackName = args.join(" ").trim();
    return run(fallbackName, undefined);
  }
  return primary;
}
