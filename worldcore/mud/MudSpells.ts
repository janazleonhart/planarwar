// worldcore/mud/MudSpells.ts

import type { MudContext } from "./MudContext";
import type { CharacterState, SpellbookState } from "../characters/CharacterTypes";

import { Logger } from "../utils/logger";
import { checkAndStartCooldown } from "../combat/Cooldowns";
import { SPELLS, SpellDefinition, findSpellByNameOrId } from "../spells/SpellTypes";
import { performNpcAttack } from "./MudActions";
import { findNpcTargetByName, isDeadEntity, resurrectEntity } from "./MudHelperFunctions";
import { getNpcPrototype } from "../npc/NpcTypes";
import {
  isServiceProtectedEntity,
  isServiceProtectedNpcProto,
  serviceProtectedCombatLine,
} from "../combat/ServiceProtection";
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
      if (!npc) {
        return `There is no '${targetRaw}' here to target with ${spell.name}.`;
      }

      // Early fail: do not consume cooldown/resource when the target is a protected service provider.
      if (isServiceProtectedNpcTarget(ctx, npc)) {
        return serviceProtectedCombatLine(npc.name);
      }

      const cdErr = cooldownGate();
      if (cdErr) return cdErr;

      const resErr = resourceGate();
      if (resErr) return resErr;

      startSpellCooldown(char, spell);

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

      applySchoolGains();
      return result;
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

      // --- NEW: simple Virtuoso buff hook using StatusEffects ---
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
