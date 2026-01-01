// worldcore/mud/MudAbilities.ts

import type { MudContext } from "./MudContext";
import type { CharacterState } from "../characters/CharacterTypes";

import { Logger } from "../utils/logger";
import { checkAndStartCooldown } from "../combat/Cooldowns";

import { ABILITIES, AbilityDefinition, findAbilityByNameOrId } from "../abilities/AbilityTypes";
import { performNpcAttack } from "./MudActions";
import { findNpcTargetByName } from "./MudHelperFunctions";

import { getNpcPrototype } from "../npc/NpcTypes";
import {
  isServiceProtectedEntity,
  isServiceProtectedNpcProto,
  serviceProtectedCombatLine,
} from "../combat/ServiceProtection";

import {
  gainPowerResource,
  getPrimaryPowerResourceForClass,
  trySpendPowerResource,
} from "../resources/PowerResources";
import { gainWeaponSkill } from "../skills/SkillProgression";
import type { WeaponSkillId } from "../combat/CombatEngine";

const log = Logger.scope("MUD_ABILITIES");

function listKnownAbilitiesForChar(char: CharacterState): AbilityDefinition[] {
  const cls = (char.classId ?? "").toLowerCase();
  const level = char.level ?? 1;

  return Object.values(ABILITIES).filter((a) => {
    const abilityClass = a.classId.toLowerCase();
    if (abilityClass !== "any" && cls && abilityClass !== cls) return false;
    if (level < a.minLevel) return false;
    return true;
  });
}

function isServiceProtectedNpcTarget(ctx: MudContext, npc: any): boolean {
  if (isServiceProtectedEntity(npc)) return true;

  if (!ctx.npcs) return false;
  const st = ctx.npcs.getNpcStateByEntityId(npc.id);
  if (!st) return false;

  const proto = getNpcPrototype(st.templateId) ?? getNpcPrototype(st.protoId);
  return isServiceProtectedNpcProto(proto);
}

export async function handleAbilityCommand(
  ctx: MudContext,
  char: CharacterState,
  abilityNameRaw: string,
  targetNameRaw?: string,
): Promise<string> {
  const ability = findAbilityByNameOrId(abilityNameRaw);
  if (!ability) {
    return `You don't know an ability called '${abilityNameRaw}'.`;
  }

  const known = listKnownAbilitiesForChar(char);
  if (!known.some((a) => a.id === ability.id)) {
    return `You do not know ${ability.name}.`;
  }

  if (!ctx.entities) {
    return "The world feels empty; you can't act.";
  }

  const self = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!self) {
    return "You have no physical form here.";
  }

  const roomId = ctx.session.roomId ?? char.shardId;
  const targetRaw = (targetNameRaw && targetNameRaw.trim()) || "rat";

  const resourceType = ability.resourceType ?? getPrimaryPowerResourceForClass(char.classId);
  const resourceCost = ability.resourceCost ?? 0;

  const cooldownGate = (): string | null => {
    const ms = ability.cooldownMs ?? 0;
    if (ms <= 0) return null;

    return checkAndStartCooldown(char, "abilities", ability.id, ms, ability.name);
  };

  const resourceGate = (): string | null => {
    return trySpendPowerResource(char, resourceType, resourceCost);
  };

  switch (ability.kind) {
    case "melee_single": {
      const npc = findNpcTargetByName(ctx.entities, roomId, targetRaw);
      if (!npc) {
        return `There is no '${targetRaw}' here to attack.`;
      }

      // Early fail: do not consume cooldown/resource when the target is a protected service provider.
      if (isServiceProtectedNpcTarget(ctx, npc)) {
        return serviceProtectedCombatLine(npc.name);
      }

      const cdErr = cooldownGate();
      if (cdErr) return cdErr;

      const resErr = resourceGate();
      if (resErr) return resErr;

      const result = await performNpcAttack(ctx, char, self, npc, {
        abilityName: ability.name,
        tagPrefix: "ability",
        channel: "weapon",
        damageMultiplier: ability.damageMultiplier,
        flatBonus: ability.flatBonus,
        weaponSkill: ability.weaponSkill as WeaponSkillId | undefined,
      });

      // Basic on-use progression scaffolding.
      if (ability.weaponSkill) {
        gainWeaponSkill(char, ability.weaponSkill as WeaponSkillId, 1);
      }

      // Default: small "feel good" resource drip back for melee abilities.
      // (This is intentionally conservative; we'll rebalance later.)
      gainPowerResource(char, resourceType, 1);

      return result;
    }

    default:
      return `Ability '${ability.name}' is not implemented yet.`;
  }
}
