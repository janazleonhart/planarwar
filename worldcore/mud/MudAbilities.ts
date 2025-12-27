// worldcore/mud/MudAbilities.ts

import { MudContext } from "./MudContext";
import { CharacterState } from "../characters/CharacterTypes";
import { findNpcTargetByName } from "./MudHelperFunctions";
import { performNpcAttack } from "./MudActions";
import {
  ABILITIES,
  findAbilityByNameOrId,
  AbilityDefinition,
} from "../abilities/AbilityTypes";
import {
  getPrimaryPowerResourceForClass,
  trySpendPowerResource,
  gainPowerResource,
} from "../resources/PowerResources";
import {
  checkAndStartCooldown,
} from "../combat/Cooldowns";
import { Logger } from "../utils/logger";

const log = Logger.scope("MUD");

function canUseAbility(
  char: CharacterState,
  ability: AbilityDefinition
): string | null {
  const cls = (char.classId ?? "").toLowerCase();

  if (cls && cls !== ability.classId.toLowerCase()) {
    return `You cannot use ${ability.name} (class restricted to ${ability.classId}).`;
  }

  const level = char.level ?? 1;
  if (level < ability.minLevel) {
    return `${ability.name} requires level ${ability.minLevel}.`;
  }

  return null;
}

/**
 * Handle "ability <name> [target]" from the MUD.
 * For now only melee_single vs NPCs is supported.
 */
export async function handleAbilityCommand(
  ctx: MudContext,
  char: CharacterState,
  abilityNameRaw: string,
  targetNameRaw?: string
): Promise<string> {
  if (!abilityNameRaw.trim()) {
    return "Usage: ability <name> [target]";
  }

  const ability = findAbilityByNameOrId(abilityNameRaw);
  if (!ability) {
    return `You don't know an ability called '${abilityNameRaw}'.`;
  }

  const error = canUseAbility(char, ability);
  if (error) return error;

  // --- Cooldown gate ---
  const abilityCooldownMs = ability.cooldownMs ?? 0;
  if (abilityCooldownMs > 0) {
    const cdErr = checkAndStartCooldown(
      char,
      "abilities",
      ability.id,
      abilityCooldownMs,
      ability.name
    );
    if (cdErr) return cdErr;
  } 

  // --- Resource gate (fury/mana/etc.) ---
  const abilityResourceType =
  ability.resourceType ?? getPrimaryPowerResourceForClass(char.classId);
  const abilityResourceCost = ability.resourceCost ?? 0;

  const resourceErr = trySpendPowerResource(
    char,
    abilityResourceType,
    abilityResourceCost
  );
  if (resourceErr) return resourceErr;

  if (!ctx.entities) {
    return "The world is strangely empty right now.";
  }

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) {
    return "You have no physical form here.";
  }

  // Default target if none provided (still handy for dummy/rats during testing)
  const targetRaw = (targetNameRaw && targetNameRaw.trim()) || "rat";
  const roomId = ctx.session.roomId ?? char.shardId;

  switch (ability.kind) {
    case "melee_single": {
      const npc = findNpcTargetByName(ctx.entities, roomId, targetRaw);
      if (!npc) {
        return `There is no '${targetRaw}' here to strike.`;
      }

      // Decide channel/tagging for the combat log
      const channel = ability.channel ?? "ability";
      const tagPrefix = "ability";

      return await performNpcAttack(ctx, char, selfEntity, npc, {
        abilityName: ability.name,
        tagPrefix,
        channel,
        damageMultiplier: ability.damageMultiplier,
        flatBonus: ability.flatBonus,
        weaponSkill: ability.weaponSkill,
        spellSchool: ability.spellSchool,
      });
    }

    default:
      log.warn("Unhandled ability kind", {
        abilityId: ability.id,
        kind: ability.kind,
      });
      return "That kind of ability is not implemented yet.";
  }
}

export function listKnownAbilitiesForChar(
  char: CharacterState
): AbilityDefinition[] {
  const cls = (char.classId ?? "").toLowerCase();
  const level = char.level ?? 1;

  return Object.values(ABILITIES).filter((a) => {
    if (cls && a.classId.toLowerCase() !== cls) return false;
    if (level < a.minLevel) return false;
    return true;
  });
}
