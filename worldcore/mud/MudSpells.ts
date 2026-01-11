// worldcore/mud/MudSpells.ts

import type { MudContext } from "./MudContext";
import type { CharacterState, SpellbookState } from "../characters/CharacterTypes";

import { Logger } from "../utils/logger";
import { checkAndStartCooldown } from "../combat/Cooldowns";
import { SPELLS, SpellDefinition, findSpellByNameOrId } from "../spells/SpellTypes";
import { performNpcAttack } from "./MudActions";
import {
  findNpcTargetByName,
  findTargetPlayerEntityByName,
  isDeadEntity,
  resurrectEntity,
  applySimpleDamageToPlayer,
  markInCombat,
} from "./MudHelperFunctions";
import { getNpcPrototype } from "../npc/NpcTypes";
import {
  isServiceProtectedEntity,
  isServiceProtectedNpcProto,
  serviceProtectedCombatLine,
} from "../combat/ServiceProtection";

import { computeEffectiveAttributes } from "../characters/Stats";
import { computeDamage, type CombatSource, type CombatTarget } from "../combat/CombatEngine";
import { DUEL_SERVICE } from "../pvp/DuelService";
import { canDamagePlayer } from "../pvp/PvpRules";
import { isPvpEnabledForRegion } from "../world/RegionFlags";
import {
  getPrimaryPowerResourceForClass,
  trySpendPowerResource,
} from "../resources/PowerResources";
import {
  gainSpellSchoolSkill,
  gainSongSchoolSkill,
  getSongSchoolSkill,
} from "../skills/SkillProgression";
import type { SongSchoolId } from "../skills/SkillProgression";
import { applyStatusEffect } from "../combat/StatusEffects";

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

function canUseSpell(char: CharacterState, spell: SpellDefinition): string | null {
  const cls = (char.classId ?? "").toLowerCase();
  const spellClass = spell.classId.toLowerCase();

  if (spellClass !== "any" && cls && cls !== spellClass) {
    return `You cannot cast ${spell.name} (class restricted to ${spellClass}).`;
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

export function listKnownSpellsForChar(char: CharacterState): SpellDefinition[] {
  const cls = (char.classId ?? "").toLowerCase();
  const level = char.level ?? 1;

  return Object.values(SPELLS).filter((s) => {
    const spellClass = s.classId.toLowerCase();
    if (spellClass !== "any" && cls && spellClass !== cls) return false;
    if (level < s.minLevel) return false;
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

/**
 * Core spell-cast path used by both:
 * - MUD 'cast' command
 * - backend-driven casts (e.g. SongEngine)
 */
export async function castSpellForCharacter(
  ctx: MudContext,
  char: CharacterState,
  spell: SpellDefinition,
  targetNameRaw?: string,
): Promise<any> {
  const err = canUseSpell(char, spell);
  if (err) return err;

  if (!ctx.entities) {
    return "The world feels strangely empty; your magic fizzles.";
  }

  const selfEntity = ctx.entities.getEntityByOwner(ctx.session.id);
  if (!selfEntity) {
    return "You have no physical form here to channel magic.";
  }

  const roomId = ctx.session.roomId ?? char.shardId;
  const targetRaw = (targetNameRaw && targetNameRaw.trim()) || "rat";

  const isSong = (spell as any).isSong === true;
  const songSchool = isSong
    ? ((spell as any).songSchool as SongSchoolId | undefined)
    : undefined;

  const spellResourceType =
    spell.resourceType ?? getPrimaryPowerResourceForClass(char.classId);
  const spellResourceCost = spell.resourceCost ?? 0;

  const applySchoolGains = () => {
    if (spell.isSong && spell.songSchool) {
      gainSongSchoolSkill(char, spell.songSchool as SongSchoolId, 1);
      return;
    }
    if (spell.school) {
      gainSpellSchoolSkill(char, spell.school, 1);
    }
  };

  const cooldownGate = (): string | null => {
    const ms = spell.cooldownMs ?? 0;
    if (ms <= 0) return null;
    return checkAndStartCooldown(char, "spells", spell.id, ms, spell.name);
  };

  const resourceGate = (): string | null => {
    return trySpendPowerResource(char, spellResourceType, spellResourceCost);
  };

  switch (spell.kind) {
    case "damage_single_npc": {
      const npc = findNpcTargetByName(ctx.entities, roomId, targetRaw);
      const playerTarget = !npc
        ? findTargetPlayerEntityByName(ctx, roomId, targetRaw)
        : null;

      if (!npc && !playerTarget) {
        return `There is no '${targetRaw}' here to target with ${spell.name}.`;
      }

      // Helper: Virtuoso "battle chant" song grants a short-lived outgoing damage buff on hit.
      const maybeApplyVirtuosoBattleChantBuff = () => {
        if (!isSong) return;
        if (spell.id !== "song_virtuoso_battle_chant") return;

        try {
          applyStatusEffect(char, {
            id: "buff_virtuoso_battle_chant_damage",
            sourceKind: "song",
            sourceId: spell.id,
            name: "Dissonant Battle Momentum",
            durationMs: 20_000,
            maxStacks: 3,
            initialStacks: 1,
            modifiers: {
              // +10% outgoing damage per stack (read by CombatEngine via computeCombatStatusSnapshot)
              damageDealtPct: 0.10,
            },
            tags: ["buff", "virtuoso", "song", "battle", "damage"],
          });
        } catch (err: any) {
          log.warn("Error applying status effect for Virtuoso battle chant", {
            spellId: spell.id,
            error: String(err),
          });
        }
      };

      // NPC path: early fail for protected service providers (do not consume cooldown/resource).
      if (npc) {
        if (isServiceProtectedNpcTarget(ctx, npc)) {
          return serviceProtectedCombatLine(npc.name);
        }
      }

      // Player path: PvP gate (fail closed) BEFORE consuming cooldown/resource.
      type PlayerGate = {
        mode: "duel" | "pvp";
        label: "duel" | "pvp";
        now: number;
        targetChar: any;
        targetSession: any;
      };

      let playerGate: PlayerGate | null = null;

      if (playerTarget) {
        const now = Date.now();
        DUEL_SERVICE.tick(now);

        const ownerSessionId = (playerTarget as any).ownerSessionId as string | undefined;
        const targetSession = ownerSessionId ? ctx.sessions?.get(ownerSessionId) : null;
        const targetChar =
          (targetSession as any)?.character ?? (targetSession as any)?.char ?? null;

        if (!targetChar?.id) {
          return "That player cannot be targeted right now (no character attached).";
        }

        const inDuel = DUEL_SERVICE.isActiveBetween(char.id, targetChar.id);
        const regionPvpEnabled = await isPvpEnabledForRegion(char.shardId, roomId);
        const gate = canDamagePlayer(char, targetChar as any, inDuel, regionPvpEnabled);

        if (!gate.allowed) {
          return gate.reason;
        }

        playerGate = {
          mode: gate.mode,
          label: gate.label,
          now,
          targetChar,
          targetSession,
        };
      }

      const cdErr = cooldownGate();
      if (cdErr) return cdErr;

      const resErr = resourceGate();
      if (resErr) return resErr;

      startSpellCooldown(char, spell);

      // Execute
      if (npc) {
        const result = await performNpcAttack(ctx, char, selfEntity, npc, {
          abilityName: spell.name,
          tagPrefix: "spell",
          channel: "spell",
          damageMultiplier: spell.damageMultiplier,
          flatBonus: spell.flatBonus,
          // Songs: treat spellSchool as "song" so CombatEngine can apply appropriate scaling.
          spellSchool: isSong ? "song" : spell.school,
          songSchool,
          isSong,
        });

        maybeApplyVirtuosoBattleChantBuff();
        applySchoolGains();
        return result;
      }

      // Player damage path (duel or region-open PvP)
      const gate = playerGate!;
      const effective = computeEffectiveAttributes(char, ctx.items);

      const source: CombatSource = {
        char,
        effective,
        channel: "spell",
        spellSchool: isSong ? "song" : spell.school,
        songSchool,
      };

      const target: CombatTarget = {
        entity: playerTarget as any,
        armor: (playerTarget as any).armor ?? 0,
        resist: (playerTarget as any).resist ?? {},
      };

      const dmgRoll = computeDamage(source, target, {
        damageMultiplier: spell.damageMultiplier,
        flatBonus: spell.flatBonus,
      });

      const oldHp = (() => {
        const e: any = playerTarget as any;
        const maxHp0 = typeof e.maxHp === "number" && e.maxHp > 0 ? e.maxHp : 100;
        return typeof e.hp === "number" && e.hp >= 0 ? e.hp : maxHp0;
      })();

      const { newHp, maxHp, killed } = applySimpleDamageToPlayer(
        playerTarget as any,
        dmgRoll.damage,
        gate.targetChar as any,
        dmgRoll.school,
        { mode: gate.mode },
      );

      const dmgFinal = Math.max(0, Math.floor(oldHp - newHp));

      markInCombat(selfEntity);
      markInCombat(playerTarget as any);

      // Notify the target (best-effort).
      if (gate.targetSession && ctx.sessions) {
        ctx.sessions.send(gate.targetSession as any, "chat", {
          from: "[world]",
          sessionId: "system",
          text: killed
            ? `[${gate.label}] ${selfEntity.name} hits you for ${dmgFinal} damage. You fall. (0/${maxHp} HP)`
            : `[${gate.label}] ${selfEntity.name} hits you for ${dmgFinal} damage. (${newHp}/${maxHp} HP)`,
          t: gate.now,
        });
      }

      if (killed && gate.mode === "duel") {
        // Duel ends on death.
        DUEL_SERVICE.endDuelFor(char.id, "death", gate.now);
      }

      maybeApplyVirtuosoBattleChantBuff();
      applySchoolGains();

      if (killed) {
        return `[${gate.label}] You hit ${playerTarget!.name} for ${dmgFinal} damage. You defeat them. (0/${maxHp} HP)`;
      }

      return `[${gate.label}] You hit ${playerTarget!.name} for ${dmgFinal} damage. (${newHp}/${maxHp} HP)`;
    }

case "heal_self": {
      const hp = (selfEntity as any).hp ?? 0;
      const maxHp = (selfEntity as any).maxHp ?? 0;

      if (maxHp <= 0) {
        return "Your body has no measurable health to heal.";
      }

      const cdErr = cooldownGate();
      if (cdErr) return cdErr;

      const resErr = resourceGate();
      if (resErr) return resErr;

      startSpellCooldown(char, spell);

      const baseHeal = spell.healAmount ?? 10;
      let heal = baseHeal;

      // Songs: scale healing from instrument/vocal skill
      if (isSong && songSchool) {
        const skill = getSongSchoolSkill(char, songSchool);
        const factor = 1 + skill / 100; // 100 skill ~= 2x base, tune later
        heal = Math.floor(baseHeal * factor);
      }

      let result: string;

      if (isDeadEntity(selfEntity)) {
        resurrectEntity(selfEntity);
        (selfEntity as any).hp = maxHp;
        result = `[spell:${spell.name}] You restore yourself to full health.\n(${maxHp}/${maxHp} HP)`;
      } else {
        const newHp = Math.min(maxHp, hp + heal);
        (selfEntity as any).hp = newHp;
        result = `[spell:${spell.name}] You restore ${newHp - hp} health.\n(${newHp}/${maxHp} HP)`;
      }

      // Simple Virtuoso buff: Song of Rising Courage → STA% buff
      if (isSong && spell.id === "virtuoso_song_rising_courage") {
        try {
          applyStatusEffect(char, {
            id: "buff_virtuoso_rising_courage_sta",
            sourceKind: "song",
            sourceId: spell.id,
            name: "Rising Courage",
            durationMs: 20_000, // 20s buff
            maxStacks: 3,
            initialStacks: 1,
            modifiers: {
              // +10% STA per stack (applied in computeEffectiveAttributes)
              attributesPct: { sta: 0.1 },
            },
            tags: ["buff", "virtuoso", "song", "courage"],
          });
        } catch (err: any) {
          log.warn("Error applying status effect for Virtuoso song", {
            spellId: spell.id,
            error: String(err),
          });
        }
      }

      applySchoolGains();
      return result;
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
  targetNameRaw?: string,
): Promise<any> {
  const spell = findSpellByNameOrId(spellNameRaw);
  if (!spell) {
    return `You don't know a spell called '${spellNameRaw}'.`;
  }
  return castSpellForCharacter(ctx, char, spell, targetNameRaw);
}
