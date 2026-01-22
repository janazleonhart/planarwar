// worldcore/mud/MudSpells.ts

import type { MudContext } from "./MudContext";
import type { CharacterState, SpellbookState } from "../characters/CharacterTypes";

import { Logger } from "../utils/logger";
import { canDamage } from "../combat/DamagePolicy";
import { checkAndStartCooldown } from "../combat/Cooldowns";
import { SPELLS, SpellDefinition, findSpellByNameOrId } from "../spells/SpellTypes";
import { performNpcAttack } from "./MudActions";
import { resolveTargetInRoom } from "../targeting/TargetResolver";
import {
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
import { getItemTemplate } from "../items/ItemCatalog";
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
import { applyStatusEffect, applyStatusEffectToEntity } from "../combat/StatusEffects";

const log = Logger.scope("MUD_SPELLS");

function getItemStatsForScaling(itemId: string, itemService: any): Record<string, any> | undefined {
  // 1) DB-backed item service (preferred)
  try {
    if (itemService && typeof itemService.get === "function") {
      const def = itemService.get(itemId);
      if (def && typeof def === "object" && (def as any).stats) {
        return (def as any).stats as Record<string, any>;
      }
    }
  } catch {
    // ignore
  }

  // 2) Static catalog fallback (dev/starter gear)
  try {
    const tmpl = getItemTemplate(itemId);
    if (tmpl && (tmpl as any).stats) return (tmpl as any).stats as Record<string, any>;
  } catch {
    // ignore
  }

  return undefined;
}

/**
 * Compute an additive instrument bonus percent from equipped gear.
 *
 * Convention:
 * - stats.instrumentPct: number (e.g. 0.25 = +25% to all songs)
 * - stats.instrumentPctBySchool: { [songSchoolId]: number } (e.g. { voice: 0.5 } )
 *
 * Result is a fraction (0.5 => +50%) to be used as: final *= (1 + bonusPct).
 */
function getEquippedInstrumentBonusPct(
  char: CharacterState,
  itemService: any,
  school?: SongSchoolId,
): number {
  const equip: any = (char as any).equipment || {};
  let out = 0;

  for (const slot of Object.keys(equip)) {
    const stack: any = equip[slot];
    if (!stack || !stack.itemId) continue;

    const stats = getItemStatsForScaling(String(stack.itemId), itemService);
    if (!stats) continue;

    const global = Number((stats as any).instrumentPct);
    if (Number.isFinite(global) && global !== 0) out += global;

    if (school) {
      const bySchool: any = (stats as any).instrumentPctBySchool;
      if (bySchool && typeof bySchool === "object") {
        const v = bySchool[school] ?? bySchool[String(school).toLowerCase()];
        const n = Number(v);
        if (Number.isFinite(n) && n !== 0) out += n;
      }
    }
  }

  // Never allow negative to create weird exploit loops.
  if (!Number.isFinite(out)) return 0;
  return Math.max(0, out);
}

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


function resolvePlayerTargetInRoom(
  ctx: MudContext,
  roomId: string,
  targetNameRaw: string
):
  | { sessionId: string; displayName: string; char: CharacterState; entity: any }
  | { err: string } {
  if (!ctx.sessions) return { err: "[world] Sessions not available." };
  if (!ctx.entities) return { err: "[world] Entities not available." };

  const needle = targetNameRaw.trim().toLowerCase();
  if (!needle) return { err: "[world] Usage: cast <spell> <target>" };

  const sessions = (ctx.sessions as any).getAllSessions?.() ?? [];
  const exact = sessions.find(
    (s: any) => (s?.character?.name ?? "").trim().toLowerCase() === needle
  );
  const candidates = exact ? [exact] : sessions.filter((s: any) => {
    const n = (s?.character?.name ?? "").trim().toLowerCase();
    return n && n.startsWith(needle);
  });

  if (!candidates.length) return { err: `[world] No such target: '${targetNameRaw}'.` };
  if (candidates.length > 1) {
    const names = candidates
      .slice(0, 5)
      .map((s: any) => s?.character?.name)
      .filter(Boolean)
      .join(", ");
    return { err: `[world] Target name '${targetNameRaw}' is ambiguous. Matches: ${names}` };
  }

  const targetSession = candidates[0];
  const sessionId = targetSession.id;
  const displayName = targetSession?.character?.name ?? targetNameRaw;
  const entity = ctx.entities.getEntityByOwner?.(sessionId);

  if (!entity) return { err: `[world] Target '${displayName}' has no active entity.` };
  if (entity.roomId !== roomId) return { err: `[world] Target '${displayName}' is not here.` };

  const char = targetSession?.character as CharacterState | undefined;
  if (!char) return { err: `[world] Target '${displayName}' has no character state loaded.` };

  return { sessionId, displayName, char, entity };
}

function spellStatusEffectOrErr(spell: SpellDefinition): { ok: true; se: any } | { ok: false; err: string } {
  const se = (spell as any).statusEffect;
  if (!se || typeof se !== "object") {
    return { ok: false, err: `[world] Spell '${spell.name}' is missing statusEffect data.` };
  }
  if (!se.id || !se.durationMs || !se.modifiers) {
    return { ok: false, err: `[world] Spell '${spell.name}' statusEffect is incomplete (need id, durationMs, modifiers).` };
  }
  return { ok: true, se };
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
  const targetRaw = (targetNameRaw ?? "").trim();

  const isSong = (spell as any).isSong === true;
  const songSchool = isSong
    ? ((spell as any).songSchool as SongSchoolId | undefined)
    : undefined;

  const instrumentBonusPct = isSong && songSchool ? getEquippedInstrumentBonusPct(char, ctx.items, songSchool) : 0;

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
      const targetName = targetRaw || "rat";

      const npc = resolveTargetInRoom(ctx.entities as any, roomId, targetName, {
        selfId: selfEntity.id,
        filter: (e: any) => e?.type === "npc" || e?.type === "mob",
        radius: 30,
      });

      // Targeting helpers return { entity, name } (for stable display names). Normalize here.
      const playerFound = !npc ? findTargetPlayerEntityByName(ctx, roomId, targetRaw) : null;
      const playerTarget: any = playerFound ? (playerFound as any).entity ?? playerFound : null;
      const playerTargetName: string =
        (playerFound as any)?.name ?? (playerTarget as any)?.name ?? targetRaw;

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
            appliedByKind: "character",
            appliedById: char.id,
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

      // NPC path: async DamagePolicy backstop BEFORE consuming cooldown/resource (region combat disabled, etc.).
      if (npc) {
        try {
          const policy = await canDamage(
            { entity: selfEntity as any, char },
            { entity: npc as any },
            { shardId: char.shardId, regionId: roomId, inDuel: false },
          );
          if (policy && policy.allowed === false) {
            return policy.reason ?? "You cannot attack here.";
          }
        } catch {
          // Best-effort: never let policy lookup crash spell casting.
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
        // gatePlayerDamageFromPlayerEntity enforces duel consent; this enforces region combat/PvP flags + service protection.
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

      startSpellCooldown(char, spell);

      // Execute
      if (npc) {
        const result = await performNpcAttack(ctx, char, selfEntity, npc, {
          abilityName: spell.name,
          tagPrefix: "spell",
          channel: "spell",
          damageMultiplier: isSong
            ? (typeof spell.damageMultiplier === "number" ? spell.damageMultiplier : 1) * (1 + instrumentBonusPct)
            : spell.damageMultiplier,
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
        damageMultiplier: isSong
          ? (typeof spell.damageMultiplier === "number" ? spell.damageMultiplier : 1) * (1 + instrumentBonusPct)
          : spell.damageMultiplier,
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

      // End duels on death if a duel is active between these characters (even if label/mode drifted).
      if (killed) {
        const oppId = String(gate.targetChar?.id ?? "");
        if (oppId && DUEL_SERVICE.isActiveBetween(char.id, oppId)) {
          DUEL_SERVICE.endDuelFor(char.id, "death", gate.now);
        }
      }

      maybeApplyVirtuosoBattleChantBuff();
      applySchoolGains();

      if (killed) {
        return `[${gate.label}] You hit ${playerTargetName} for ${dmgFinal} damage. You defeat them. (0/${maxHp} HP)`;
      }

      return `[${gate.label}] You hit ${playerTargetName} for ${dmgFinal} damage. (${newHp}/${maxHp} HP)`;
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

      // Songs: scale healing from instrument/vocal skill + optional equipped instrument bonus
      if (isSong && songSchool) {
        const skill = getSongSchoolSkill(char, songSchool);
        const factor = 1 + skill / 100; // 100 skill ~= 2x base, tune later
        const instrumentFactor = 1 + instrumentBonusPct;
        heal = Math.floor(baseHeal * factor * instrumentFactor);
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

    case "heal_single_ally": {
      if (!ctx.entities) return "[world] Entities not available.";
      if (!ctx.sessions) return "[world] Sessions not available.";

      const res = resolvePlayerTargetInRoom(ctx, roomId, targetRaw);
      if ("err" in res) return res.err;

      const cdErr = cooldownGate();
      if (cdErr) return cdErr;

      const resErr = resourceGate();
      if (resErr) return resErr;

      startSpellCooldown(char, spell);

      const baseHeal = Math.max(0, Math.floor(spell.healAmount ?? 0));
      if (baseHeal <= 0) return "[world] That spell has no healing effect.";

      let heal = baseHeal;
      if (isSong && songSchool) {
        const skill = getSongSchoolSkill(char, songSchool);
        const factor = 1 + skill / 100;
        const instrumentFactor = 1 + instrumentBonusPct;
        heal = Math.floor(baseHeal * factor * instrumentFactor);
      }

      const before = res.entity.hp;
      const after = Math.min(res.entity.maxHp, before + heal);
      res.entity.hp = after;

      if (spell.isSong && spell.songSchool) {
        gainSongSchoolSkill(char, spell.songSchool, 1);
      }

      const gained = after - before;
      return `[world] [spell:${spell.name}] You restore ${gained} health to ${res.displayName}. (${after}/${res.entity.maxHp} HP)`;
    }

    case "buff_self": {
      const cdErr = cooldownGate();
      if (cdErr) return cdErr;

      const resErr = resourceGate();
      if (resErr) return resErr;

      const seRes = spellStatusEffectOrErr(spell);
      if (!seRes.ok) return seRes.err;

      startSpellCooldown(char, spell);

      applyStatusEffect(char, {
        id: seRes.se.id,
        sourceKind: spell.isSong ? "song" : "spell",
        sourceId: spell.id,
        stackingPolicy: seRes.se.stackingPolicy,
        appliedByKind: "character",
        appliedById: char.id,
        name: seRes.se.name ?? spell.name,
        durationMs: seRes.se.durationMs,
        maxStacks: seRes.se.maxStacks,
        stacks: seRes.se.stacks ?? 1,
        modifiers: seRes.se.modifiers,
        tags: seRes.se.tags,
      });

      if (spell.isSong && spell.songSchool) {
        gainSongSchoolSkill(char, spell.songSchool, 1);
      }

      return `[world] [spell:${spell.name}] You gain ${seRes.se.name ?? spell.name}.`;
    }

    case "buff_single_ally": {
      if (!ctx.entities) return "[world] Entities not available.";
      if (!ctx.sessions) return "[world] Sessions not available.";

      const res = resolvePlayerTargetInRoom(ctx, roomId, targetRaw);
      if ("err" in res) return res.err;

      const cdErr = cooldownGate();
      if (cdErr) return cdErr;

      const resErr = resourceGate();
      if (resErr) return resErr;

      const seRes = spellStatusEffectOrErr(spell);
      if (!seRes.ok) return seRes.err;

      startSpellCooldown(char, spell);

      applyStatusEffect(res.char, {
        id: seRes.se.id,
        sourceKind: spell.isSong ? "song" : "spell",
        sourceId: spell.id,
        stackingPolicy: seRes.se.stackingPolicy,
        appliedByKind: "character",
        appliedById: char.id,
        name: seRes.se.name ?? spell.name,
        durationMs: seRes.se.durationMs,
        maxStacks: seRes.se.maxStacks,
        stacks: seRes.se.stacks ?? 1,
        modifiers: seRes.se.modifiers,
        tags: seRes.se.tags,
      });

      if (spell.isSong && spell.songSchool) {
        gainSongSchoolSkill(char, spell.songSchool, 1);
      }

      return `[world] [spell:${spell.name}] You bless ${res.displayName} with ${seRes.se.name ?? spell.name}.`;
    }

    case "debuff_single_npc":
    case "damage_dot_single_npc": {
      const targetName = targetRaw || "rat";
      const npc = resolveTargetInRoom(ctx.entities as any, roomId, targetName, {
        selfId: selfEntity.id,
        filter: (e: any) => e?.type === "npc" || e?.type === "mob",
        radius: 30,
      });

      if (!npc) {
        return `There is no '${targetRaw}' here to target with ${spell.name}.`;
      }

      // Protected NPCs (vendors/bankers/etc) are never valid combat targets.
      if (isServiceProtectedNpcTarget(ctx, npc)) {
        return serviceProtectedCombatLine(npc.name);
      }

      // Region / policy gate BEFORE consuming cooldown/resource.
      try {
        const policy = await canDamage(
          { entity: selfEntity as any, char },
          { entity: npc as any },
          { shardId: char.shardId, regionId: roomId, inDuel: false },
        );
        if (policy && policy.allowed === false) {
          return policy.reason ?? "You cannot affect that target here.";
        }
      } catch {
        // Best-effort: never let policy lookup crash spell casting.
      }

      const cdErr = cooldownGate();
      if (cdErr) return cdErr;

      const resErr = resourceGate();
      if (resErr) return resErr;

      startSpellCooldown(char, spell);

      const se = spell.statusEffect;
      if (!se) {
        return `[world] [spell:${spell.name}] That spell has no status effect definition.`;
      }

      const now = Date.now();

      if (spell.kind === "debuff_single_npc") {
        // Apply a pure modifier-only effect to the NPC.
        applyStatusEffectToEntity(npc as any, {
          id: se.id,
          sourceKind: isSong ? "song" : "spell",
          sourceId: spell.id,
          stackingPolicy: se.stackingPolicy,
          appliedByKind: "character",
          appliedById: char.id,
          name: se.name ?? spell.name,
          durationMs: se.durationMs,
          maxStacks: se.maxStacks,
          initialStacks: se.stacks,
          modifiers: se.modifiers ?? {},
          tags: se.tags ?? ["debuff"],
        }, now);

        markInCombat(selfEntity);
        markInCombat(npc as any);

        applySchoolGains();
        return `[world] [spell:${spell.name}] You afflict ${npc.name} with ${se.name ?? spell.name}.`;
      }

      // DOT: compute a base total damage roll, then distribute it across ticks.
      const tickIntervalMs = Math.max(250, Math.floor(Number(se.dot?.tickIntervalMs ?? 2000)));
      const ticks = Math.max(1, Math.floor(se.durationMs / tickIntervalMs));

      const effective = computeEffectiveAttributes(char, ctx.items);

      const source: CombatSource = {
        char,
        effective,
        channel: "spell",
        spellSchool: isSong ? "song" : spell.school,
        songSchool,
      };

      const target: CombatTarget = {
        entity: npc as any,
        armor: (npc as any).armor ?? 0,
        resist: (npc as any).resist ?? {},
      };

      const dmgRoll = computeDamage(source, target, {
        damageMultiplier: isSong
          ? (typeof spell.damageMultiplier === "number" ? spell.damageMultiplier : 1) * (1 + instrumentBonusPct)
          : spell.damageMultiplier,
        flatBonus: spell.flatBonus,
      });

      const total = Math.max(1, Math.floor(dmgRoll.damage));
      const spread = se.dot?.spreadDamageAcrossTicks !== false;
      const perTick = spread ? Math.max(1, Math.floor(total / ticks)) : total;

      applyStatusEffectToEntity(npc as any, {
        id: se.id,
        sourceKind: isSong ? "song" : "spell",
        sourceId: spell.id,
        stackingPolicy: se.stackingPolicy,
        appliedByKind: "character",
        appliedById: char.id,
        name: se.name ?? spell.name,
        durationMs: se.durationMs,
        maxStacks: se.maxStacks,
        initialStacks: se.stacks,
        modifiers: se.modifiers ?? {},
        tags: se.tags ?? ["dot", "debuff"],
        dot: {
          tickIntervalMs,
          perTickDamage: perTick,
          damageSchool: (spell.school as any) ?? "pure",
        },
      }, now);

      markInCombat(selfEntity);
      markInCombat(npc as any);

      applySchoolGains();
      return `[world] [spell:${spell.name}] You afflict ${npc.name} with ${se.name ?? spell.name}.`;
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