// worldcore/mud/MudSpells.ts

import type { MudContext } from "./MudContext";
import type { CharacterState } from "../characters/CharacterTypes";

import { Logger } from "../utils/logger";
import { canDamage } from "../combat/DamagePolicy";
import { checkAndStartCooldown, getCooldownRemaining } from "../combat/Cooldowns";
import {
  SpellDefinition,
  findSpellByNameOrId,
  ensureSpellbookAutogrants,
  isSpellKnownForChar,
} from "../spells/SpellTypes";
import { performNpcAttack } from "./MudActions";
import {
  findNpcTargetByName,
  findTargetPlayerEntityByName,
  isDeadEntity,
  resurrectEntity,
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
import { applyCombatResultToPlayer } from "../combat/entityCombat";
import { gatePlayerDamageFromPlayerEntity } from "./MudCombatGates";
import { DUEL_SERVICE } from "../pvp/DuelService";
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

function canUseSpell(char: CharacterState, spell: SpellDefinition): string | null {
  const cls = String(char.classId ?? "").toLowerCase();
  const spellClass = String(spell.classId ?? "any").toLowerCase();

  if (spellClass !== "any" && cls && cls !== spellClass) {
    return `You cannot cast ${spell.name} (class restricted to ${spellClass}).`;
  }

  const level = char.level ?? 1;
  if (level < spell.minLevel) {
    return `${spell.name} requires level ${spell.minLevel}.`;
  }

  // MVP spellbook: auto-grant eligible spells so players have a usable baseline.
  ensureSpellbookAutogrants(char);

  // Debug spells are callable even if not learned.
  if (!spell.isDebug && !isSpellKnownForChar(char, spell.id)) {
    return `You have not learned ${spell.name}.`;
  }

  const remaining = getCooldownRemaining(char, "spells", spell.id);
  if (remaining > 0) {
    const sec = Math.ceil(remaining / 1000);
    return `${spell.name} is on cooldown for another ${sec}s.`;
  }

  return null;
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

  const isSong = spell.isSong === true;
  const songSchool = isSong ? ((spell.songSchool as SongSchoolId | undefined) ?? undefined) : undefined;

  const spellResourceType = spell.resourceType ?? getPrimaryPowerResourceForClass(char.classId);
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

      // Helper: Virtuoso battle chant grants a short-lived outgoing damage buff on hit.
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
        const gateRes = await gatePlayerDamageFromPlayerEntity(ctx, char, roomId, playerTarget);
        if (!gateRes.allowed) {
          return gateRes.reason;
        }

        playerGate = {
          mode: gateRes.mode,
          label: gateRes.label,
          now: gateRes.now,
          targetChar: gateRes.targetChar,
          targetSession: gateRes.targetSession,
        };

        // Lane D: async DamagePolicy backstop for player-vs-player damage.
        try {
          const policy = await canDamage(
            { entity: selfEntity as any, char },
            { entity: playerTarget as any, char: gateRes.targetChar as any },
            { shardId: char.shardId, regionId: roomId, inDuel: gateRes.mode === "duel" },
          );
          if (policy && policy.allowed === false) {
            return policy.reason ?? "You cannot attack here.";
          }
        } catch {
          // Best-effort: never let policy lookup crash spell casting.
        }
      }

      const cdErr = cooldownGate();
      if (cdErr) return cdErr;

      const resErr = resourceGate();
      if (resErr) return resErr;

      // Execute
      if (npc) {
        const result = await performNpcAttack(ctx, char, selfEntity, npc, {
          abilityName: spell.name,
          tagPrefix: "spell",
          channel: "spell",
          damageMultiplier: spell.damageMultiplier,
          flatBonus: spell.flatBonus,
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

      const { newHp, maxHp, killed } = applyCombatResultToPlayer(
        playerTarget as any,
        dmgRoll,
        gate.targetChar as any,
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

      const baseHeal = spell.healAmount ?? 10;
      let heal = baseHeal;

      // Songs: scale healing from instrument/vocal skill
      if (isSong && songSchool) {
        const skill = getSongSchoolSkill(char, songSchool);
        const factor = 1 + skill / 100;
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

      // Virtuoso buff: Song of Rising Courage → STA% buff
      if (isSong && spell.id === "virtuoso_song_rising_courage") {
        try {
          applyStatusEffect(char, {
            id: "buff_virtuoso_rising_courage_sta",
            sourceKind: "song",
            sourceId: spell.id,
            name: "Rising Courage",
            durationMs: 20_000,
            maxStacks: 3,
            initialStacks: 1,
            modifiers: {
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
      log.warn("Unhandled spell kind", { spellId: spell.id, kind: (spell as any).kind });
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
