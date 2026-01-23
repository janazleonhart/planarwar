// worldcore/mud/commands/combat/castCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";

import { handleCastCommand } from "../../MudSpells";

interface CastInput {
  cmd: string;
  args: string[];
  parts: string[];
}

function isUnknownSpellResult(res: any): boolean {
  if (typeof res !== "string") return false;
  // Keep this loose: handleCastCommand currently returns this exact prefix on unknown spell.
  return res.startsWith("You don't know a spell called '");
}

export async function handleCastMudCommand(
  ctx: MudContext,
  char: CharacterState,
  input: CastInput
): Promise<string> {
  const args =
    Array.isArray(input?.args) && input.args.length > 0
      ? input.args
      : Array.isArray(input?.parts)
        ? input.parts.slice(1)
        : [];

  if (!args.length) {
    return "Usage: cast <spell> [target]";
  }

  // UX hardening: allow multi-word spell names without forcing quotes.
  //
  // Strategy:
  // 1) Try treating the entire remainder as the spell name ("battle chant").
  // 2) If that doesn't resolve to a known spell, treat the last token as a target ("heal Ally").
  //
  // This avoids incorrectly parsing multi-word spell names where the first token might itself
  // be a valid spell ("battle" vs "battle chant").
  const fullName = args.join(" ").trim();
  const attemptFull = await handleCastCommand(ctx, char, fullName, "");
  if (!isUnknownSpellResult(attemptFull) || args.length < 2) {
    return attemptFull;
  }

  const spellName = args.slice(0, -1).join(" ").trim();
  const targetRaw = String(args[args.length - 1] ?? "").trim();
  if (!spellName) {
    return "Usage: cast <spell> [target]";
  }

  return handleCastCommand(ctx, char, spellName, targetRaw);
}
