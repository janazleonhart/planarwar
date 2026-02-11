// worldcore/mud/commands/player/trainCommand.ts
//
// Spell + Ability Rank System v0.1
//
// "train" converts granted (pending) spell/ability ranks into learned entries.

import type { MudContext } from "../../MudContext";

import { listPendingSpellsForChar } from "../../../spells/SpellLearning";
import { listPendingAbilitiesForChar } from "../../../abilities/AbilityLearning";
import { getSpellByIdOrAlias } from "../../../spells/SpellTypes";
import { findAbilityByNameOrId } from "../../../abilities/AbilityTypes";

function fmtList(items: string[], label: string): string {
  if (!items.length) return `${label}: none.`;
  const lines = items.map((id) => {
    const name = label === "Spells" ? (getSpellByIdOrAlias(id) as any)?.name : (findAbilityByNameOrId(id) as any)?.name;
    return `- ${name ? `${name} ` : ""}(${id})`;
  });
  return `${label} pending training:\n${lines.join("\n")}`;
}

export async function handleTrainCommand(ctx: MudContext, args: string[]): Promise<string> {
  const char = ctx.session.character;
  if (!char) return "You do not have an active character.";
  if (!ctx.characters) return "Character service unavailable.";

  const sub = String(args[0] ?? "").trim().toLowerCase();

  // Default: show what is pending.
  if (!sub || sub === "list") {
    const pSpells = listPendingSpellsForChar(char as any);
    const pAbilities = listPendingAbilitiesForChar(char as any);
    if (!pSpells.length && !pAbilities.length) {
      return "You have nothing waiting to be trained.";
    }
    const parts: string[] = [];
    if (pSpells.length) parts.push(fmtList(pSpells, "Spells"));
    if (pAbilities.length) parts.push(fmtList(pAbilities, "Abilities"));
    return parts.join("\n\n");
  }

  // train spell <id|name>
  // train ability <id|name>
  if (sub === "spell" || sub === "sp") {
    const raw = args.slice(1).join(" ").trim();
    if (!raw) return "Usage: train spell <spellId|spellName>";

    const def: any = getSpellByIdOrAlias(raw);
    if (!def) return "Unknown spell.";

    const pending = new Set(listPendingSpellsForChar(char as any));
    if (!pending.has(def.id)) {
      return `You do not have ${def.name} granted (pending training).`;
    }

    const res = await ctx.characters.learnSpellWithRules(
      (char as any).userId,
      (char as any).id,
      def.id,
      1,
      { viaTrainer: true },
    );

    if (!res.ok) {
      if (res.error === "requires_grant") return `You do not have ${def.name} granted (pending training).`;
      if (res.error === "requires_trainer") return "You must be at a trainer to learn that.";
      if (res.error === "level_too_low") return `You are not high enough level to learn ${def.name}.`;
      if (res.error === "not_learnable") return "You cannot learn that.";
      return `Training failed: ${res.error}`;
    }

    // Update session character to the persisted result.
    ctx.session.character = res.character as any;
    return `You train ${def.name}.`;
  }

  if (sub === "ability" || sub === "ab") {
    const raw = args.slice(1).join(" ").trim();
    if (!raw) return "Usage: train ability <abilityId|abilityName>";

    const def: any = findAbilityByNameOrId(raw);
    if (!def) return "Unknown ability.";

    const pending = new Set(listPendingAbilitiesForChar(char as any));
    if (!pending.has(def.id)) {
      return `You do not have ${def.name} granted (pending training).`;
    }

    const res = await ctx.characters.learnAbilityWithRules(
      (char as any).userId,
      (char as any).id,
      def.id,
      1,
      { viaTrainer: true },
    );

    if (!res.ok) {
      if (res.error === "requires_grant") return `You do not have ${def.name} granted (pending training).`;
      if (res.error === "requires_trainer") return "You must be at a trainer to learn that.";
      if (res.error === "level_too_low") return `You are not high enough level to learn ${def.name}.`;
      if (res.error === "not_learnable") return "You cannot learn that.";
      return `Training failed: ${res.error}`;
    }

    ctx.session.character = res.character as any;
    return `You train ${def.name}.`;
  }

  return "Usage: train [list] | train spell <spell> | train ability <ability>";
}
