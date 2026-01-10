// worldcore/mud/commands/combat/abilityCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { MudCommandInput } from "../types";
import { handleAbilityCommand } from "../../MudAbilities";

/**
 * MUD wrapper for the core ability handler.
 *
 * Supports:
 *   ability <idOrName>
 *   ability <idOrName> <targetHandle>
 *   ability <multi word name> <targetHandle>
 *
 * If the last arg looks like an entity handle (e.g. "rat.1"),
 * it is treated as target and the rest is joined as the ability name.
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
    // Simple case: ability <name>
    abilityName = args[0];
    targetRaw = undefined;
  } else {
    const last = args[args.length - 1];

    // Heuristic: if the last token looks like an entity handle (has a dot),
    // treat it as the target; otherwise everything is part of the ability name.
    if (last.includes(".")) {
      abilityName = args.slice(0, -1).join(" ");
      targetRaw = last;
    } else {
      abilityName = args.join(" ");
      targetRaw = undefined;
    }
  }

  return handleAbilityCommand(
    ctx,
    char,
    abilityName,
    targetRaw && targetRaw.trim() ? targetRaw : undefined,
  );
}
