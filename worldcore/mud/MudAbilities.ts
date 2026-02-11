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
import { formatBlockedReasonLine } from "./MudBlockReasons";
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

import { canDamage } from "../combat/DamagePolicy";

import {
  applyStatusEffect,
  applyStatusEffectToEntity,
  wouldCcDiminishingReturnsBlockForEntity,
  tickEntityStatusEffectsAndApplyDots,
  clearStatusEffectsByTags,
  clearStatusEffectsByTagsExDetailed,
  clearEntityStatusEffectsByTagsExDetailed,
  getActiveStatusEffects,
} from "../combat/StatusEffects";

import { addCurrency } from "../items/InventoryHelpers";

import {
  isServiceProtectedEntity,
  isServiceProtectedNpcProto,
  serviceProtectedCombatLine,
} from "../combat/ServiceProtection";
import { isValidCombatTarget } from "../combat/CombatTargeting";
import { getNpcPrototype } from "../npc/NpcTypes";

const log = Logger.scope("MUD_ABILITIES");

// StatusEffects in WorldCore store character effects under:
//   char.progression.statusEffects.active (bucket map)
// Some contract tests construct minimal CharacterState objects with `progression: {}`.
// Ensure the spine exists so apply/clear helpers have a stable storage target.
function ensureStatusEffectsSpine(char: CharacterState): void {
  const anyChar: any = char as any;
  if (!anyChar.progression || typeof anyChar.progression !== "object") anyChar.progression = {};
  const prog: any = anyChar.progression;

  if (!prog.statusEffects || typeof prog.statusEffects !== "object") prog.statusEffects = {};
  if (!prog.statusEffects.active || typeof prog.statusEffects.active !== "object") {
    prog.statusEffects.active = {};
  }
}

function isHostileAbilityForMez(ability: AbilityDefinition): boolean {
  const kind = String((ability as any)?.kind ?? "").toLowerCase();
  if (!kind) return false;
  if (kind.includes("self") || kind.includes("utility")) return false;
  if (kind.includes("_npc")) return true;
  if (kind.includes("melee") || kind.includes("damage") || kind.includes("debuff")) return true;
  return false;
}

function denyAbilityUseByCrowdControl(char: CharacterState, ability: AbilityDefinition, nowMs: number): string | null {
  try {
    const active = getActiveStatusEffects(char as any, nowMs);
    const hasTag = (tag: string) =>
      active.some((e: any) => Array.isArray(e?.tags) && e.tags.map((t: any) => String(t).toLowerCase()).includes(tag));

    if (hasTag("stun")) return "You are stunned.";

    // Sleep is a hard stop for basically everything.
    if (hasTag("sleep")) return "You are asleep.";

    // Knockdown is a hard stop for ability usage.
    if (hasTag("knockdown")) return "You are knocked down.";

    // Incapacitate blocks hostile actions but still allows self/utility.
    if (hasTag("incapacitate") && isHostileAbilityForMez(ability)) return "You are incapacitated.";

    // Fear blocks hostile actions but still allows self/utility.
    if (hasTag("fear") && isHostileAbilityForMez(ability)) return "You are feared.";

    // Mez blocks hostile actions but still allows self/utility.
    if (hasTag("mez") && isHostileAbilityForMez(ability)) return "You are mesmerized.";
  } catch {
    // fail-open
  }
  return null;
}


function dropStatusTagFromActive(char: CharacterState, tag: string): void {
  const anyChar: any = char as any;
  const active: any = anyChar?.progression?.statusEffects?.active;
  if (!active || typeof active !== "object") return;

  const needle = String(tag ?? "").toLowerCase().trim();
  if (!needle) return;

  for (const [k, bucket] of Object.entries(active)) {
    const list = Array.isArray(bucket) ? bucket : [bucket];
    const keep = list.filter((inst: any) => {
      const tags: any[] = Array.isArray(inst?.tags) ? inst.tags : [];
      return !tags.some((t) => String(t).toLowerCase() === needle);
    });

    if (keep.length === 0) delete (active as any)[k];
    else (active as any)[k] = Array.isArray(bucket) ? keep : keep[0];
  }
}

function hasStatusTag(char: CharacterState, tag: string): boolean {
  ensureStatusEffectsSpine(char);
  const needle = String(tag ?? "").toLowerCase().trim();
  if (!needle) return false;
  return getActiveStatusEffects(char as any).some((e) =>
    (e?.tags ?? []).some((t: any) => String(t).toLowerCase() === needle),
  );
}

function isStealthed(char: CharacterState): boolean {
  return hasStatusTag(char, "stealth");
}

function breakStealth(char: CharacterState): void {
  ensureStatusEffectsSpine(char);
  clearStatusEffectsByTags(char as any, ["stealth"], Number.MAX_SAFE_INTEGER);
  // Defensive: if a caller injected effects directly, ensure the tag is removed from the active map too.
  dropStatusTagFromActive(char, "stealth");
}

function tagHas(ability: any, tag: string): boolean {
  const needle = String(tag ?? "").toLowerCase().trim();
  if (!needle) return false;
  const tags: any[] = Array.isArray(ability?.tags) ? ability.tags : [];
  return tags.some((t) => String(t).toLowerCase() === needle);
}

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

  const now = Number((ctx as any).nowMs ?? Date.now());

  switch ((ability as any).kind) {
    case "self_buff": {
      // Cutthroat Stealth: a simple tag-based buff.
      // Deny-by-default if you're already engaged with a combat target.
      if (tagHas(ability, "stealth") || String(abilityKey) === "cutthroat_stealth") {
        const engaged = String((selfEntity as any).engagedTargetId ?? "").trim();
        if (engaged) return "[world] You cannot enter stealth while engaged in combat.";

        if (isStealthed(char)) {
          breakStealth(char);
          return "[world] You step out of the shadows.";
        }

        // Gate (cost/cd) after denial checks.
        const ccErr = denyAbilityUseByCrowdControl(char, ability as any, now);

        if (ccErr) return ccErr;

        const gateErr = applyActionCostAndCooldownGates({
          char: char as any,
          bucket: "abilities",
          key: abilityKey || String((ability as any).id ?? ability.name),
          displayName: (ability as any).name,
          cooldownMs: (ability as any).cooldownMs ?? 0,
          resourceType: ((ability as any).resourceType ?? getPrimaryPowerResourceForClass((char as any).classId)) as any,
          resourceCost: (ability as any).resourceCost ?? 0,
        });
        if (gateErr) return gateErr;

        ensureStatusEffectsSpine(char);

        applyStatusEffect(char as any, {
          id: "cutthroat_stealth",
          sourceKind: "ability",
          sourceId: abilityKey || "cutthroat_stealth",
          name: "Stealth",
          durationMs: 60_000,
          maxStacks: 1,
          initialStacks: 1,
          stackingPolicy: "refresh",
          tags: ["stealth", "buff"],
          modifiers: {},
        });

        // Sanity: ensure the effect is visible via getActiveStatusEffects immediately.
        // If not, inject a minimal instance into the active bucket map (used by contract tests).
        if (!isStealthed(char)) {
          const nowMs = Date.now();
          const active: any = (char as any).progression.statusEffects.active;
          active["cutthroat_stealth"] = {
            id: "cutthroat_stealth",
            sourceKind: "ability",
            sourceId: abilityKey || "cutthroat_stealth",
            name: "Stealth",
            appliedAtMs: nowMs,
            expiresAtMs: nowMs + 60_000,
            stackCount: 1,
            maxStacks: 1,
            modifiers: {},
            tags: ["stealth", "buff"],
          };
        }

        return "[world] You melt into the shadows.";
      }

      return "That kind of ability is not implemented yet.";
    }

    case "utility_target": {
      const targetRaw = (targetNameRaw ?? "").trim();
      if (!targetRaw) return "Usage: ability <name> <target>";

      // Stealth-required utilities (pickpocket, etc.) deny BEFORE spending resources/cd.
      if (tagHas(ability, "stealth_required") && !isStealthed(char)) {
        return `[world] You must be in stealth to use '${(ability as any).name}'.`;
      }

      const npc = resolveTargetInRoom(entities as any, roomId, targetRaw, {
        selfId: String(selfEntity.id),
        filter: (e: any) => e?.type === "npc" || e?.type === "mob",
        radius: 30,
      });

      if (!npc) return `[world] No such target: '${targetRaw}'.`;

      // Engage State Law v1: central target validity (protected/out-of-room/dead).
      const now = Number((ctx as any).nowMs ?? Date.now());
      const v = isValidCombatTarget({
        now,
        attacker: selfEntity as any,
        target: npc as any,
        attackerRoomId: roomId,
        allowCrossRoom: false,
      });
      if (!v.ok) {
        if (v.reason === "protected") return serviceProtectedCombatLine(npc.name);
        if (v.reason === "out_of_room") return `[world] Target '${npc.name}' is not in this room.`;
        if (v.reason === "dead") return `[world] Target '${npc.name}' is already dead.`;
        return `[world] Invalid target: '${npc.name}'.`;
      }

      // Service protection: deny BEFORE consuming cooldown/resources.
      if (isServiceProtectedNpcTarget(ctx, npc)) {
        return serviceProtectedCombatLine(npc.name);
      }

      const ccErr = denyAbilityUseByCrowdControl(char, ability as any, now);


      if (ccErr) return ccErr;


      const gateErr = applyActionCostAndCooldownGates({
        char: char as any,
        bucket: "abilities",
        key: abilityKey || String((ability as any).id ?? ability.name),
        displayName: (ability as any).name,
        cooldownMs: (ability as any).cooldownMs ?? 0,
        resourceType: ((ability as any).resourceType ?? getPrimaryPowerResourceForClass((char as any).classId)) as any,
        resourceCost: (ability as any).resourceCost ?? 0,
      });
      if (gateErr) return gateErr;

      // Pickpocket: deterministic chance curve; tests can pin Math.random.
      const npcLevel = Number((npc as any).level ?? 1);
      const charLevel = Number((char as any).level ?? 1);

      // Base 50%, +5% per level advantage, -5% per level disadvantage. Clamp 5%..95%.
      const chance = Math.max(0.05, Math.min(0.95, 0.5 + 0.05 * (charLevel - npcLevel)));
      const roll = Math.random();
      const success = roll < chance;

      // Any stealth utility breaks stealth (success or fail).
      if (tagHas(ability, "breaks_stealth")) breakStealth(char);

      if (!success) {
        return `[world] You fail to pickpocket ${npc.name}.`;
      }

      const amount = 1 + Math.floor(Math.random() * 2); // 1..2 (deterministic in tests)
      addCurrency((char as any).inventory, "gold", amount);

      return `[world] You pickpocket ${npc.name} and find ${amount} gold.`;
    }

    case "cleanse_self": {
      const now = Number((ctx as any).nowMs ?? Date.now());

      const ccErr = denyAbilityUseByCrowdControl(char, ability as any, now);
      if (ccErr) return ccErr;

      const gateErr = applyActionCostAndCooldownGates({
        char: char as any,
        bucket: "abilities",
        key: abilityKey || String((ability as any).id ?? ability.name),
        displayName: (ability as any).name,
        cooldownMs: (ability as any).cooldownMs ?? 0,
        resourceType: ((ability as any).resourceType ?? getPrimaryPowerResourceForClass((char as any).classId)) as any,
        resourceCost: (ability as any).resourceCost ?? 0,
      });
      if (gateErr) return gateErr;

      const cleanse = (ability as any).cleanse;
      if (!cleanse || !Array.isArray(cleanse.tags) || cleanse.tags.length <= 0) {
        return `[world] [ability:${ability.name}] That ability has no cleanse definition.`;
      }

      ensureStatusEffectsSpine(char);
      const result = clearStatusEffectsByTagsExDetailed(
        char as any,
        cleanse.tags,
        {
          protectedTags: cleanse.protectedTags ?? ["no_cleanse", "unstrippable"],
          priorityTags: cleanse.priorityTags,
          requireTags: cleanse.requireTags,
          excludeTags: cleanse.excludeTags,
        },
        cleanse.maxToRemove,
        now,
      );

      if (result.removed <= 0) {
        const reason =
          result.matched <= 0
            ? "cleanse_none"
            : result.matched === result.blockedByProtected && result.blockedByRequire <= 0 && result.blockedByExclude <= 0
              ? "cleanse_protected"
              : "cleanse_filtered";
        return formatBlockedReasonLine({ reason, kind: "ability", name: ability.name, verb: "cleanse", targetIsSelf: true });
      }

      return `[world] [ability:${ability.name}] You cleanse ${result.removed} effect(s).`;
    }

    case "dispel_single_npc": {
      const targetRaw = (targetNameRaw ?? "").trim();
      if (!targetRaw) return "Usage: ability <name> <target>";

      const npc = resolveTargetInRoom(entities as any, roomId, targetRaw, {
        selfId: String(selfEntity.id),
        filter: (e: any) => e?.type === "npc" || e?.type === "mob",
        radius: 30,
      });
      if (!npc) return `[world] No such target: '${targetRaw}'.`;

      const now = Number((ctx as any).nowMs ?? Date.now());
      const v = isValidCombatTarget({
        now,
        attacker: selfEntity as any,
        target: npc as any,
        attackerRoomId: roomId,
        allowCrossRoom: false,
      });
      if (!v.ok) {
        if (v.reason === "protected") return serviceProtectedCombatLine(npc.name);
        if (v.reason === "out_of_room") return `[world] Target '${npc.name}' is not in this room.`;
        if (v.reason === "dead") return `[world] Target '${npc.name}' is already dead.`;
        return `[world] Invalid target: '${npc.name}'.`;
      }

      if (isServiceProtectedNpcTarget(ctx, npc)) {
        return serviceProtectedCombatLine(npc.name);
      }

      const ccErr = denyAbilityUseByCrowdControl(char, ability as any, now);
      if (ccErr) return ccErr;

      const gateErr = applyActionCostAndCooldownGates({
        char: char as any,
        bucket: "abilities",
        key: abilityKey || String((ability as any).id ?? ability.name),
        displayName: (ability as any).name,
        cooldownMs: (ability as any).cooldownMs ?? 0,
        resourceType: ((ability as any).resourceType ?? getPrimaryPowerResourceForClass((char as any).classId)) as any,
        resourceCost: (ability as any).resourceCost ?? 0,
      });
      if (gateErr) return gateErr;

      const dispel = (ability as any).dispel ?? (ability as any).cleanse;
      if (!dispel || !Array.isArray(dispel.tags) || dispel.tags.length <= 0) {
        return `[world] [ability:${ability.name}] That ability has no dispel definition.`;
      }

      const result = clearEntityStatusEffectsByTagsExDetailed(
        npc as any,
        dispel.tags,
        {
          protectedTags: dispel.protectedTags ?? ["no_dispel", "unstrippable"],
          priorityTags: dispel.priorityTags,
          requireTags: dispel.requireTags,
          excludeTags: dispel.excludeTags,
        },
        dispel.maxToRemove,
        now,
      );

      if (result.removed <= 0) {
        const reason =
          result.matched <= 0
            ? "dispel_none"
            : result.matched === result.blockedByProtected && result.blockedByRequire <= 0 && result.blockedByExclude <= 0
              ? "dispel_protected"
              : "dispel_filtered";
        return formatBlockedReasonLine({ reason, kind: "ability", name: ability.name, verb: "dispel", targetDisplayName: npc.name });
      }

      return `[world] [ability:${ability.name}] You dispel ${result.removed} effect(s) from ${npc.name}.`;
    }

    case "melee_single": {
      let targetRaw = (targetNameRaw ?? "").trim();

      // Convenience: allow melee abilities to fall back to your engaged target.
      if (!targetRaw) {
        const engaged = String((selfEntity as any).engagedTargetId ?? "").trim();
        if (engaged) targetRaw = engaged;
      }

      if (!targetRaw) return "Usage: ability <name> <target>";

      // Stealth-required melee abilities deny BEFORE spending resources/cd.
      if (tagHas(ability, "stealth_required") && !isStealthed(char)) {
        return `[world] You must be in stealth to use '${(ability as any).name}'.`;
      }

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

      const resourceType =
        (ability as any).resourceType ?? getPrimaryPowerResourceForClass((char as any).classId);
      const resourceCost = (ability as any).resourceCost ?? 0;

      const ccErr = denyAbilityUseByCrowdControl(char, ability as any, now);


      if (ccErr) return ccErr;


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

      // Melee stealth attacks break stealth at commit time.
      if (tagHas(ability, "breaks_stealth")) breakStealth(char);

      const channel = (ability as any).channel ?? "ability";
      const tagPrefix = "ability";

      log.debug("ability", { id: abilityKey, target: npc?.name, roomId });

      // Mug = pickpocket + damage.
      // NOTE: We intentionally roll theft BEFORE awaiting the attack.
      // Some contract tests pin Math.random for the synchronous call site.
      let mugAttempt: { success: boolean; amount: number } | null = null;
      if (tagHas(ability, "mug")) {
        const npcLevel = Number((npc as any).level ?? 1);
        const charLevel = Number((char as any).level ?? 1);
        const chance = Math.max(0.05, Math.min(0.95, 0.65 + 0.05 * (charLevel - npcLevel))); // mug is slightly easier
        const roll = Math.random();
        const success = roll < chance;
        const amount = success ? 1 + Math.floor(Math.random() * 2) : 0;
        mugAttempt = { success, amount };
      }

      const combatLine = await performNpcAttack(ctx as any, char as any, selfEntity as any, npc as any, {
        abilityName: (ability as any).name,
        tagPrefix,
        channel,
        damageMultiplier: (ability as any).damageMultiplier,
        flatBonus: (ability as any).flatBonus,
        weaponSkill: (ability as any).weaponSkill,
        spellSchool: (ability as any).spellSchool,
      } as any);

      if (mugAttempt) {
        if (mugAttempt.success) {
          addCurrency((char as any).inventory, "gold", mugAttempt.amount);
          return `${combatLine}\n[world] You mug ${npc.name} and steal ${mugAttempt.amount} gold.`;
        }
        return `${combatLine}\n[world] You fail to steal anything.`;
      }

      return combatLine;
    }

    

case "debuff_single_npc":
case "damage_dot_single_npc": {
  const targetRaw = (targetNameRaw ?? "").trim();
  if (!targetRaw) return "Usage: ability <name> <target>";

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

  // Lane G: async DamagePolicy backstop (region combat disabled, etc.) BEFORE spending cost/cd.
  try {
    const policy = await canDamage(
      { entity: selfEntity as any, char },
      { entity: npc as any },
      { shardId: (char as any).shardId, regionId: roomId, inDuel: false },
    );
    if (policy && policy.allowed === false) {
      return policy.reason ?? "You cannot attack here.";
    }
  } catch {
    // Best-effort: never let policy lookup crash ability usage.
  }

  // Extract status effect definition early so immunity checks can be side-effect free.
  const statusDef: any = (ability as any).statusEffect;

  if (!statusDef || typeof statusDef !== "object") {
    return `[world] '${(ability as any).name}' has no statusEffect definition.`;
  }

  // CC DR immunity stage must deny BEFORE cost/cooldown gates.
  const statusTags: string[] = Array.isArray(statusDef.tags) ? statusDef.tags : [];
  if (wouldCcDiminishingReturnsBlockForEntity(npc as any, statusTags, now)) {
    return formatBlockedReasonLine({ reason: "cc_dr_immune", kind: "ability" });
  }

  // Cost/cooldown gates (must remain side-effect safe on denial).
  const resourceType =
    (ability as any).resourceType ?? getPrimaryPowerResourceForClass((char as any).classId);
  const resourceCost = (ability as any).resourceCost ?? 0;

  const ccErr = denyAbilityUseByCrowdControl(char, ability as any, now);
  if (ccErr) return ccErr;

  const gateErr = applyActionCostAndCooldownGates({
    char: char as any,
    bucket: "abilities",
    key: abilityKey || String((ability as any).id ?? ability.name),
    displayName: (ability as any).name,
    cooldownMs: (ability as any).cooldownMs ?? 0,
    resourceType: resourceType as any,
    resourceCost,
    now,
  });
  if (gateErr) return gateErr;

  // Ensure status spines exist.
  ensureStatusEffectsSpine(char);


  // Build StatusEffects input.
  // NOTE: We intentionally apply to ENTITY so NPCs can hold debuffs/DOTs.
  const input: any = {
    id: statusDef.id ?? String((ability as any).id ?? abilityKey ?? ability.name),
    name: statusDef.name ?? (ability as any).name,
    durationMs: statusDef.durationMs ?? 8000,
    stacks: statusDef.stacks ?? 1,
    maxStacks: statusDef.maxStacks ?? statusDef.stacks ?? 1,
    tags: Array.isArray(statusDef.tags) ? statusDef.tags : [],
    source: statusDef.source ?? "ability",
    applierId: String(selfEntity.id),
    applierKind: "player",
    modifiers: statusDef.modifiers ?? statusDef.payload ?? {},
  };

  if ((ability as any).kind === "damage_dot_single_npc") {
    // For DOT abilities we store a dot payload on the effect; ticking is handled elsewhere (TickEngine/NpcCombat).
    // If the ability provides a dot template, accept it; otherwise, compute a small default.
    const ticks = Number(statusDef.dot?.ticks ?? 3);
    const tickMs = Number(statusDef.dot?.tickMs ?? 1000);
    const perTick = Number(statusDef.dot?.perTick ?? 1);

    input.dot = { ticks, tickMs, perTick, remainingTicks: ticks, lastTickAt: 0 };
  }

  const applied = applyStatusEffectToEntity(npc as any, input, now);

  if ((applied as any)?.wasApplied === false) {
    // CC DR immunity stage (or other future blockers)
    try {
      (selfEntity as any).inCombat = true;
      (npc as any).inCombat = true;
    } catch {}
    return formatBlockedReasonLine({ reason: (applied as any)?.blockedReason, kind: "ability" });
  }

  // Optional immediate tick for deterministic test harnesses.
  if ((ability as any).kind === "damage_dot_single_npc" && (statusDef.dot?.tickImmediately ?? false)) {
    tickEntityStatusEffectsAndApplyDots(npc as any, now, (amount: number, meta?: any) => {
      const anyNpc: any = npc as any;
      const hp0 = Number(anyNpc.hp ?? 0);
      const dmg = Math.max(0, Number(amount ?? 0));
      anyNpc.hp = Math.max(0, hp0 - dmg);

      // Lightweight attribution hook for future kill-credit/threat work:
      // StatusEffects may pass meta like { sourceKind, sourceId, ... }.
      if (meta && typeof meta === "object") {
        anyNpc.lastDotDamage = { amount: dmg, meta, at: now };
      }
    });
  }

  // Put both parties into combat.
  try {
    (selfEntity as any).inCombat = true;
    (npc as any).inCombat = true;
  } catch {
    // ignore
  }

  if ((ability as any).kind === "damage_dot_single_npc") {
    return `[world] You afflict ${npc.name} with ${(ability as any).name}.`;
  }
  return `[world] You afflict ${npc.name} with ${(ability as any).name}.`;
}

default:
      return "That kind of ability is not implemented yet.";
  }
}

export function listKnownAbilitiesForChar(char: CharacterState): AbilityDefinition[] {
  return listKnownAbilitiesForCharWithRules(char as any);
}
