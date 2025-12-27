// worldcore/mud/MudSpells.ts

import type { MudContext } from "./MudContext";
import type {
  CharacterState,
  SpellbookState,
} from "../characters/CharacterTypes";

import {
  SPELLS,
  SpellDefinition,
  findSpellByNameOrId,
} from "../spells/SpellTypes";

import { performNpcAttack } from "./MudActions";
import {
  findNpcTargetByName,
  isDeadEntity,
  resurrectEntity,
} from "./MudHelperFunctions";

import {
  getPrimaryPowerResourceForClass,
  trySpendPowerResource,
  gainPowerResource,
} from "../resources/PowerResources";

import { checkAndStartCooldown } from "../combat/Cooldowns";
import { Logger } from "../utils/logger";

const log = Logger.scope("MUD_SPELLS");

function ensureSpellbook(char: CharacterState): SpellbookState {
  let sb: any = char.spellbook as any;

  if (!sb || typeof sb !== "object") {
    sb = { known: {}, cooldowns: {} };
    (char as any).spellbook = sb;
  } else {
    if (!sb.known) sb.known = {};
    if (!sb.cooldowns) sb.cooldowns = {};
  }

  return sb as SpellbookState;
}

function canUseSpell(
  char: CharacterState,
  spell: SpellDefinition
): string | null {
  const cls = (char.classId ?? "").toLowerCase();
  const spellClass = spell.classId.toLowerCase();

  if (spellClass !== "any" && cls && cls !== spellClass) {
    return `You cannot cast ${spell.name} (class restricted to ${spell.classId}).`;
  }

  const level = char.level ?? 1;
  if (level < spell.minLevel) {
    return `${spell.name} requires level ${spell.minLevel}.`;
  }

  const sb = ensureSpellbook(char);
  const now = Date.now();
  const readyAt = sb.cooldowns?.[spell.id];

  if (readyAt && readyAt > now) {
    const ms = readyAt - now;
    const sec = Math.ceil(ms / 1000);
    return `${spell.name} is on cooldown for another ${sec}s.`;
  }

  return null;
}

function startSpellCooldown(char: CharacterState, spell: SpellDefinition): void {
  if (!spell.cooldownMs || spell.cooldownMs <= 0) return;

  const sb = ensureSpellbook(char);
  const now = Date.now();

  if (!sb.cooldowns) sb.cooldowns = {};
  sb.cooldowns[spell.id] = now + spell.cooldownMs;
}

export function listKnownSpellsForChar(
  char: CharacterState
): SpellDefinition[] {
  const cls = (char.classId ?? "").toLowerCase();
  const level = char.level ?? 1;

  return Object.values(SPELLS).filter((s) => {
    const spellClass = s.classId.toLowerCase();
    if (spellClass !== "any" && cls && spellClass !== cls) return false;
    if (level < s.minLevel) return false;
    return true;
  });
}

/**
 * Core spell-cast path used by both:
 *  - MUD 'cast' command
 *  - future backend-driven casts (e.g. SongEngine)
 */
export async function castSpellForCharacter(
  ctx: MudContext,
  char: CharacterState,
  spell: SpellDefinition,
  targetNameRaw?: string
): Promise<string> {
  const err = canUseSpell(char, spell);
  if (err) return err;

  const spellCooldownMs = spell.cooldownMs ?? 0;
  if (spellCooldownMs > 0) {
    const cdErr = checkAndStartCooldown(
      char,
      "spells",
      spell.id,
      spellCooldownMs,
      spell.name
    );
    if (cdErr) return cdErr;
  }

  // --- Resource gate (mana/fury/etc.) ---
  const spellResourceType =
    spell.resourceType ?? getPrimaryPowerResourceForClass(char.classId);
  const spellResourceCost = spell.resourceCost ?? 0;

  const resourceErr = trySpendPowerResource(
    char,
    spellResourceType,
    spellResourceCost
  );
  if (resourceErr) return resourceErr;

  if (!ctx.entities) {
    return "The world feels strangely empty; your magic fizzles.";
  }

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) {
    return "You have no physical form here to channel magic.";
  }

  const roomId = ctx.session.roomId ?? char.shardId;
  const targetRaw = (targetNameRaw && targetNameRaw.trim()) || "rat";

  switch (spell.kind) {
    case "damage_single_npc": {
      const npc = findNpcTargetByName(ctx.entities, roomId, targetRaw);
      if (!npc) {
        return `There is no '${targetRaw}' here to target with ${spell.name}.`;
      }

      startSpellCooldown(char, spell);

      return await performNpcAttack(ctx, char, selfEntity, npc, {
        abilityName: spell.name,
        tagPrefix: "spell",
        channel: "spell",
        damageMultiplier: spell.damageMultiplier,
        flatBonus: spell.flatBonus,
        spellSchool: spell.school, // may be undefined; that's fine
      });
    }

    case "heal_self": {
      const hp = (selfEntity as any).hp ?? 0;
      const maxHp = (selfEntity as any).maxHp ?? 0;
      const heal = spell.healAmount ?? 10;

      if (maxHp <= 0) {
        return "Your body has no measurable health to heal.";
      }

      startSpellCooldown(char, spell);

      if (isDeadEntity(selfEntity)) {
        resurrectEntity(selfEntity);
        return `[spell:${spell.name}] You restore yourself to full health.\n(${maxHp}/${maxHp} HP)`;
      }

      const newHp = Math.min(maxHp, hp + heal);
      (selfEntity as any).hp = newHp;

      return `[spell:${spell.name}] You restore ${
        newHp - hp
      } health. (${newHp}/${maxHp} HP)`;
    }

    default: {
      log.warn("Unhandled spell kind", { spellId: spell.id, kind: spell.kind });
      return "That kind of spell is not implemented yet.";
    }
  }
}

/**
 * Handle "cast <spell> [target]" from the MUD.
 */
export async function handleCastCommand(
  ctx: MudContext,
  char: CharacterState,
  spellNameRaw: string,
  targetNameRaw?: string
): Promise<string> {
  const spell = findSpellByNameOrId(spellNameRaw);
  if (!spell) {
    return `You don't know a spell called '${spellNameRaw}'.`;
  }

  return castSpellForCharacter(ctx, char, spell, targetNameRaw);
}
