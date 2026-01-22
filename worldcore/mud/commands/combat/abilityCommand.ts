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

  let abilityName = "";
  let targetRaw: string | undefined;

  if (args.length === 1) {
    abilityName = args[0];
    targetRaw = undefined;
  } else {
    const last = String(args[args.length - 1] ?? "").trim();

    const parsed = parseHandleToken(last);
    const looksLikeNearbyHandle = !!(parsed && typeof parsed.idx === "number");

    // Allow entity ids that end with ".<digits>" too (common "npc.rat.1" style).
    const looksLikeHandleishId = /\.[0-9]+$/.test(last) && !/\s/.test(last);

    if (looksLikeNearbyHandle || looksLikeHandleishId) {
      abilityName = args.slice(0, -1).join(" ").trim();
      targetRaw = last;
    } else {
      abilityName = args.join(" ").trim();
      targetRaw = undefined;
    }
  }

  if (!abilityName) return "Usage: ability <name|id> [target]";

  return handleAbilityCommand(ctx, char, abilityName, targetRaw && targetRaw.trim() ? targetRaw : undefined);
}
