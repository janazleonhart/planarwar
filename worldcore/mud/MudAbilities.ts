// worldcore/mud/MudAbilities.ts
//
// Ability execution entrypoint for MUD.
//
// Invariants (hardened by contract tests):
// - Target validation + service protection checks happen BEFORE spending resources or starting cooldowns.
// - Cost/cooldown gates are centralized (CastingGates) and must remain side-effect safe on denial.
//
// System 5 update: ability unlock/learning rules.
// - Canonical persistent ability id is the ABILITIES map key.
// - AbilityDefinition.id/name are treated as aliases for lookups.

import type { MudContext } from "./MudContext";
import type { CharacterState } from "../characters/CharacterTypes";

import { Logger } from "../utils/logger";
import { applyActionCostAndCooldownGates } from "../combat/CastingGates";

import { resolveTargetInRoom } from "../targeting/TargetResolver";

import {
  ABILITIES,
  findAbilityByNameOrId,
  type AbilityDefinition,
} from "../abilities/AbilityTypes";

import { resolveAbilityKey } from "../abilities/AbilityUnlocks";
import { isAbilityKnownForChar, listKnownAbilitiesForChar as listKnownAbilitiesForCharWithRules } from "../abilities/AbilityLearning";

import { getPrimaryPowerResourceForClass } from "../resources/PowerResources";

import { performNpcAttack } from "./MudActions";

import {
  isServiceProtectedEntity,
  isServiceProtectedNpcProto,
  serviceProtectedCombatLine,
} from "../combat/ServiceProtection";
import { getNpcPrototype } from "../npc/NpcTypes";

const log = Logger.scope("MUD_ABILITIES");

function normalizeAbilityKey(raw: string): string {
  const q = String(raw ?? "").trim();
  if (!q) return "";
  return resolveAbilityKey(q) ?? q;
}

function isServiceProtectedNpcTarget(ctx: MudContext, npc: any): boolean {
  // 1) direct entity tag/flag
  if (isServiceProtectedEntity(npc)) return true;

  // 2) npc prototype tag (best effort)
  const st = (ctx as any).npcs?.getNpcStateByEntityId?.(npc.id);
  if (!st) return false;

  const protoId = (st as any).templateId ?? (st as any).protoId ?? (st as any).proto_id;
  const proto = protoId ? getNpcPrototype(String(protoId)) : null;
  return isServiceProtectedNpcProto(proto as any);
}

/**
 * Handle "ability <name> [target]" from the MUD.
 *
 * For now only melee_single vs NPCs is supported.
 */
export async function handleAbilityCommand(
  ctx: MudContext,
  char: CharacterState,
  abilityNameRaw: string,
  targetNameRaw?: string,
): Promise<string> {
  const raw = (abilityNameRaw ?? "").trim();
  if (!raw) return "Usage: ability <name> [target]";

  const ability = findAbilityByNameOrId(raw);
  if (!ability) return `[world] Unknown ability '${raw}'.`;

  // Resolve canonical id/key early so it matches unlock rules + persistence.
  const abilityKey = normalizeAbilityKey(String((ability as any).id ?? raw));

  // Gate "known" (DB/test mode) without breaking legacy fallback.
  if (!isAbilityKnownForChar(char as any, abilityKey)) {
    return `[world] You have not learned ability '${ability.name}'.`;
  }

  const entities = (ctx as any).entities;
  if (!entities) return "[world] No world entity manager wired.";

  // Legacy/current convention: session.roomId is authoritative.
  const roomId = (ctx as any).session?.roomId ?? (ctx as any).roomId ?? (char as any).roomId;
  if (!roomId) return "[world] You cannot use abilities right now.";

  const ownerId = (ctx as any).session?.id ?? (ctx as any).sessionId;
  const selfEntity = entities.getEntityByOwner?.(ownerId);
  if (!selfEntity) return "[world] You are not currently present in the world.";

  switch ((ability as any).kind) {
    case "melee_single": {
      const targetRaw = (targetNameRaw ?? "").trim();
      if (!targetRaw) return "Usage: ability <name> <target>";

      // Resolve using shared TargetResolver so numeric + nearby handles line up with `nearby` output.
      const npc = resolveTargetInRoom(entities as any, roomId, targetRaw, {
        selfId: String(selfEntity.id),
        filter: (e: any) => e?.type === "npc" || e?.type === "mob",
        radius: 30,
      });

      if (!npc) return `[world] No such target: '${targetRaw}'.`;

      // Service protection gate: deny BEFORE consuming cooldown/resources.
      if (isServiceProtectedNpcTarget(ctx, npc)) {
        return serviceProtectedCombatLine(npc.name);
      }

      // Centralized cost+cooldown gate (side-effect safe on denial)
      const resourceType =
        (ability as any).resourceType ?? getPrimaryPowerResourceForClass((char as any).classId);
      const resourceCost = (ability as any).resourceCost ?? 0;

      const gateErr = applyActionCostAndCooldownGates({
        char: char as any,
        bucket: "abilities",
        key: abilityKey || String((ability as any).id ?? ability.name),
        displayName: (ability as any).name,
        cooldownMs: (ability as any).cooldownMs ?? 0,
        resourceType: resourceType as any,
        resourceCost,
      });
      if (gateErr) return gateErr;

      // Decide channel/tagging for the combat log
      const channel = (ability as any).channel ?? "ability";
      const tagPrefix = "ability";

      log.debug("ability", { id: abilityKey, target: npc?.name, roomId });

      return await performNpcAttack(ctx as any, char as any, selfEntity as any, npc as any, {
        abilityName: (ability as any).name,
        tagPrefix,
        channel,
        damageMultiplier: (ability as any).damageMultiplier,
        flatBonus: (ability as any).flatBonus,
        weaponSkill: (ability as any).weaponSkill,
        spellSchool: (ability as any).spellSchool,
      } as any);
    }

    default:
      return "That kind of ability is not implemented yet.";
  }
}

export function listKnownAbilitiesForChar(char: CharacterState): AbilityDefinition[] {
  return listKnownAbilitiesForCharWithRules(char as any);
}
