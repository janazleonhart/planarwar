// worldcore/mud/MudSpells.ts

import type { MudContext } from "./MudContext";
import type { CharacterState, SpellbookState } from "../characters/CharacterTypes";

import { Logger } from "../utils/logger";
import { canDamage } from "../combat/DamagePolicy";
import { SPELLS, SpellDefinition, findSpellByNameOrId } from "../spells/SpellTypes";
import { applyProfileToPetVitals } from "../pets/PetProfiles";
import { applyPetGearToVitals } from "../pets/PetGear";
import { performNpcAttack } from "./MudActions";
import { resolveTargetInRoom } from "../targeting/TargetResolver";
import { findTargetPlayerEntityByName } from "../targeting/targetFinders";
import { getNpcPrototype } from "../npc/NpcTypes";
import {
  isServiceProtectedEntity,
  isServiceProtectedNpcProto,
  serviceProtectedCombatLine,
} from "../combat/ServiceProtection";

import { computeEffectiveAttributes } from "../characters/Stats";
import { getItemTemplate } from "../items/ItemCatalog";
import { computeDamage, type CombatSource, type CombatTarget } from "../combat/CombatEngine";
import { applyCombatResultToPlayer, isDeadEntity, resurrectEntity, markInCombat } from "../combat/entityCombat";
import { gatePlayerDamageFromPlayerEntity } from "./MudCombatGates";
import { DUEL_SERVICE } from "../pvp/DuelService";
import {
  getPrimaryPowerResourceForClass,
} from "../resources/PowerResources";
import {
  gainSpellSchoolSkill,
  gainSongSchoolSkill,
} from "../skills/SkillProgression";
import type { SongSchoolId } from "../skills/SkillProgression";
import { applyStatusEffect, applyStatusEffectToEntity, clearStatusEffectsByTags, getActiveStatusEffects } from "../combat/StatusEffects";
import { applyActionCostAndCooldownGates } from "../combat/CastingGates";
import { computeSongScalar } from "../songs/SongScaling";
import { isCombatEnabledForRegion } from "../world/RegionFlags";
const log = Logger.scope("MUD_SPELLS");

function ensureStatusEffectsSpineForCombat(char: CharacterState): void {
  const anyChar: any = char as any;
  if (!anyChar.progression || typeof anyChar.progression !== "object") anyChar.progression = {};
  const prog: any = anyChar.progression;
  if (!prog.statusEffects || typeof prog.statusEffects !== "object") prog.statusEffects = {};
  const se: any = prog.statusEffects;
  if (!se.active || typeof se.active !== "object") se.active = {};
}

function isStealthedForCombat(char: CharacterState): boolean {
  try {
    const active = getActiveStatusEffects(char as any);
    return active.some((e: any) => Array.isArray(e?.tags) && e.tags.includes("stealth"));
  } catch {
    return false;
  }
}

function breakStealthForCombat(char: CharacterState): void {
  ensureStatusEffectsSpineForCombat(char);
  try {
    // StatusEffects.clearStatusEffectsByTags expects a numeric maxToRemove.
    clearStatusEffectsByTags(char as any, ["stealth"], Number.MAX_SAFE_INTEGER);
  } catch {
    // best-effort
  }
}


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

function getSpellCooldownRemainingMs(char: CharacterState, spellId: string, now: number): number {
  const sb = ensureSpellbook(char);
  const readyAt = Number((sb as any).cooldowns?.[spellId]?.readyAt ?? 0);
  if (!Number.isFinite(readyAt) || readyAt <= 0) return 0;
  return Math.max(0, readyAt - now);
}

function canUseSpell(char: CharacterState, spell: SpellDefinition, now: number): string | null {
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
  const cdEntry = sb.cooldowns?.[spell.id];
  const readyAt = cdEntry?.readyAt ?? 0;

  if (readyAt > now) {
    const ms = readyAt - now;
    const sec = Math.ceil(ms / 1000);
    return `${spell.name} is on cooldown for another ${sec}s.`;
  }

  return null;
}

function startSpellCooldown(char: CharacterState, spell: SpellDefinition, now: number): void {
  if (!spell.cooldownMs || spell.cooldownMs <= 0) return;

  const sb = ensureSpellbook(char);
  if (!sb.cooldowns) sb.cooldowns = {};
  sb.cooldowns[spell.id] = { readyAt: now + spell.cooldownMs };
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
  targetTokenRaw: string
):
  | { sessionId: string; displayName: string; char: CharacterState; entity: any }
  | { err: string } {
  if (!ctx.sessions) return { err: "[world] Sessions not available." };
  if (!ctx.entities) return { err: "[world] Entities not available." };

  const token = String(targetTokenRaw ?? "").trim();
  if (!token) return { err: "[world] Usage: cast <spell> <target>" };

  const selfSessionId = String((ctx as any)?.session?.id ?? "");
  const selfEntity = ctx.entities.getEntityByOwner?.(selfSessionId);
  if (!selfEntity) return { err: "[world] You have no active entity." };

  // Explicit self-target tokens.
  const isSelfToken = (() => {
    const n = token.toLowerCase();
    return n === "me" || n === "self" || n === "myself";
  })();

  const sessions: any[] = Array.from((ctx.sessions as any).getAllSessions?.() ?? []);

  const selfSession =
    sessions.find((s) => s && String(s.id ?? "") === selfSessionId) ?? (ctx as any).session;
  const selfChar = (selfSession?.character as CharacterState | undefined) ?? undefined;
  const selfDisplayName = (selfChar?.name ?? "you").trim() || "you";

  if (isSelfToken) {
    if (!selfChar) return { err: "[world] Your character state is not loaded." };
    return { sessionId: selfSessionId, displayName: selfDisplayName, char: selfChar, entity: selfEntity };
  }

  // Candidate players in this room:
  // - Prefer entity.roomId as the source of truth (tests often omit session.roomId).
  // - Still accept session.roomId when entities are delayed.
  const roomRows: Array<{ s: any; ent: any; name: string }> = [];
  for (const s of sessions) {
    if (!s || !s.id) continue;
    const sid = String(s.id);
    if (sid === selfSessionId) continue;

    const ent = ctx.entities.getEntityByOwner?.(sid);
    if (!ent) continue;

    const inRoom =
      String(ent.roomId ?? "") === roomId || String((s as any).roomId ?? "") === roomId;
    if (!inRoom) continue;

    // Player-like only (exclude spawned NPCs/nodes).
    const t = String(ent.type ?? "").toLowerCase();
    const hasSpawnPoint = typeof (ent as any).spawnPointId === "number";
    const isPlayerLike = t === "player" || (!!(ent as any).ownerSessionId && !hasSpawnPoint);
    if (!isPlayerLike) continue;

    const name = String(s?.character?.name ?? ent?.name ?? "").trim();
    roomRows.push({ s, ent, name });
  }

  const candidates = roomRows.map((r) => r.ent);
  const byEntityId = new Map<string, any>();
  for (const r of roomRows) {
    const id = String(r.ent?.id ?? "").trim();
    if (id) byEntityId.set(id, r.s);
  }

  // New: use TargetResolver semantics for players (id / index / handle / base).
  const originX = Number((selfEntity as any).x ?? (selfEntity as any).posX ?? 0);
  const originZ = Number((selfEntity as any).z ?? (selfEntity as any).posZ ?? 0);

  const picked = candidates.length
    ? resolveTargetInRoom(candidates as any, roomId, token, {
        selfId: String((selfEntity as any).id ?? ""),
        viewerSessionId: selfSessionId,
        radius: 30,
        originX,
        originZ,
      })
    : null;

  if (picked) {
    const id = String((picked as any).id ?? "").trim();
    const s = (id && byEntityId.get(id)) || null;
    const displayName = String(s?.character?.name ?? (picked as any).name ?? token).trim() || token;

    const targetChar = s?.character as CharacterState | undefined;
    if (!targetChar) return { err: `[world] Target '${displayName}' has no character state loaded.` };

    return { sessionId: String(s.id ?? ""), displayName, char: targetChar, entity: picked };
  }

  // Legacy fallback: allow partial character-name matching (case-insensitive), with ambiguity reporting.
  const needle = token.toLowerCase();

  const nameMatches = roomRows
    .filter((r) => r && r.s && String(r.s.id ?? "") !== selfSessionId)
    .filter((r) => String(r.name ?? "").toLowerCase().includes(needle));

  if (!nameMatches.length) return { err: `[world] No such target: '${targetTokenRaw}'.` };

  if (nameMatches.length > 1) {
    const names = nameMatches
      .slice(0, 5)
      .map((r) => r?.name)
      .filter(Boolean)
      .join(", ");
    return {
      err: `[world] Target token '${targetTokenRaw}' is ambiguous. Matches: ${names} (use 'nearby' handles like name.2)`,
    };
  }

  const row = nameMatches[0];
  const sessionId = String(row.s.id ?? "");
  const displayName = String(row.name ?? targetTokenRaw).trim() || targetTokenRaw;
  const entity = row.ent;

  const targetChar = row.s?.character as CharacterState | undefined;
  if (!targetChar) return { err: `[world] Target '${displayName}' has no character state loaded.` };

  return { sessionId, displayName, char: targetChar, entity };
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
  const now = Number((ctx as any).nowMs ?? Date.now());

  const err = canUseSpell(char, spell, now);
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

  const applyGates = (): string | null => {
    // Legacy spellbook cooldown gate.
    const spellbookRemainingMs = getSpellCooldownRemainingMs(char, spell.id, now);
    if (spellbookRemainingMs > 0) {
      const seconds = Math.ceil(spellbookRemainingMs / 1000);
      return `${spell.name} is on cooldown for another ${seconds}s.`;
    }

    // Canonical gates: cost + progression cooldown (side-effect safe).
    const err = applyActionCostAndCooldownGates({
      char,
      bucket: "spells",
      key: spell.id,
      cooldownMs: spell.cooldownMs ?? 0,
      resourceType: spellResourceType,
      resourceCost: spellResourceCost,
      displayName: spell.name,
      now,
    });
    if (err) return err;

    // Keep the spellbook mirror in sync.
    startSpellCooldown(char, spell, now);
    return null;
  };


  switch (spell.kind) {
    
    case "summon_pet": {
      // Pet summoning is treated as a combat action for region gating.
      // In WORLDCORE_TEST, RegionFlags overrides are keyed by "regionId" — our tests use roomId as regionId.
      const ownerSessionId = String((ctx as any)?.session?.id ?? "").trim();
      const ownerEntity =
        ownerSessionId && typeof (ctx.entities as any)?.getEntityByOwner === "function"
          ? (ctx.entities as any).getEntityByOwner(ownerSessionId)
          : null;

      if (!ownerEntity) return "[world] You do not have an active body in the world.";

      const roomId =
        String((ownerEntity as any)?.roomId ?? "") ||
        String((ctx as any)?.session?.roomId ?? "") ||
        String((char as any)?.roomId ?? "") ||
        String((char as any)?.room ?? "");
      if (!roomId) return "[world] You are nowhere (missing room).";

      // Deny path: combat disabled regions must block BEFORE cost/cooldown and BEFORE pet spawn.
      try {
        const shardId = String((char as any)?.shardId ?? "prime_shard");
        const allowed = await isCombatEnabledForRegion(shardId, roomId);
        if (!allowed) return "[world] Combat is disabled here.";
      } catch {
        // best-effort: if RegionFlags isn't wired, don't crash
      }

      const summon = (spell as any)?.summon as any;
      const petProtoId = String(summon?.petProtoId ?? "").trim();
      if (!petProtoId) return "This spell has no summon payload.";

      const ownerEntityId = String((ownerEntity as any)?.id ?? "");

      // Enforce single active pet: remove any existing pet for this owner.
      try {
	        const ents: any = ctx.entities as any;

	        // Preferred (EntityManager) helper.
	        if (typeof ents?.removePetForOwnerEntityId === "function") {
	          ents.removePetForOwnerEntityId(ownerEntityId);
	        } else {
	          // Test harness + lightweight entity adapters expose removeEntity + getPetByOwnerEntityId/getAll.
	          const existing: any =
	            (typeof ents?.getPetByOwnerEntityId === "function" ? ents.getPetByOwnerEntityId(ownerEntityId) : null) ||
	            (typeof ents?.getAll === "function"
	              ? ents
	                  .getAll()
	                  .find((e: any) => e?.type === "pet" && String(e?.ownerEntityId ?? "") === String(ownerEntityId))
	              : null);

	          if (existing && typeof ents?.removeEntity === "function") {
	            ents.removeEntity(existing.id);
	          }
	        }
      } catch {
        // ignore
      }

      const createPetEntity = (ctx.entities as any)?.createPetEntity;
      const createNpcEntity = (ctx.entities as any)?.createNpcEntity;

      let pet: any;
      if (typeof createPetEntity === "function") {
        // EntityManager signature: (roomId, model, ownerEntityId)
        pet = createPetEntity(roomId, petProtoId, ownerEntityId);
      } else if (typeof createNpcEntity === "function") {
        // Legacy fallback: treat pet like an NPC with extra tags.
        pet = createNpcEntity(roomId, petProtoId);
        (pet as any).type = "pet";
        (pet as any).ownerEntityId = ownerEntityId;
      } else {
        return "[spell] Cannot summon: entity factory missing.";
      }

      // Personal visibility: pets are owner-only for v1.
      (pet as any).ownerSessionId = ownerSessionId;

      // Default stance + follow semantics (v1)
      (pet as any).petMode = String(summon?.stance ?? "defensive");
      (pet as any).followOwner = typeof summon?.followOwner === "boolean" ? summon.followOwner : true;

      // v1.4: Role first, species/skin second.
      // - petRole: pet_tank | pet_dps | pet_heal | pet_utility
      // - petClass: flavor/species (beast/undead/demon/elemental/construct) or legacy tag
      (pet as any).petRole = String(summon?.petRole ?? summon?.role ?? "").trim() || undefined;
      (pet as any).petClass = String(summon?.petClass ?? summon?.petSkin ?? "").trim() || undefined;

      // Tags are additive; we normalize/enforce in PetProfiles.
      const tagsIn = Array.isArray(summon?.petTags) ? summon.petTags : [];
      (pet as any).petTags = Array.isArray((pet as any).petTags) ? (pet as any).petTags : [];
      for (const t of tagsIn) (pet as any).petTags.push(t);

      // If the character already had persisted pet gear, attach it to the new entity.
      // This keeps the "swap pet" loop feeling consistent.
      try {
        const flagsPet = (char as any)?.progression?.flags?.pet;
        if (flagsPet && typeof flagsPet === "object" && flagsPet.gear && typeof flagsPet.gear === "object") {
          (pet as any).equipment = flagsPet.gear;
        }
      } catch {
        // ignore
      }

      try {
        applyProfileToPetVitals(pet as any);
      } catch {
        // best-effort
      }

      // v1.4: Pet gear influences vitals immediately (damage hooks consume cached bonuses).
      try {
        applyPetGearToVitals(pet as any, (ctx as any).items);
      } catch {
        // best-effort
      }

      // Persist desired pet state so reconnect/world rejoin can restore it.
      try {
        const prog: any = (char as any).progression ?? ((char as any).progression = {});
        const flags: any = prog.flags ?? (prog.flags = {});
        flags.pet = {
          active: true,
          protoId: petProtoId,
          petRole: (pet as any).petRole ?? undefined,
          petClass: (pet as any).petClass ?? undefined,
          mode: (pet as any).petMode ?? "defensive",
          followOwner: (pet as any).followOwner !== false,
          autoSummon: true,
        };

        (ctx as any)?.session && ((ctx as any).session.character = char);
        await (ctx as any)?.characters?.saveCharacter?.(char);
      } catch {
        // never fail the cast for persistence
      }

      return `[spell:${spell.name}] You summon ${petProtoId}.`;
    }

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
        const denyToken = targetRaw || targetName;
        return `[world] No such target: '${denyToken}'.`;
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

        // Stealth: you can't directly target a stealthed player.
        if (isStealthedForCombat(gateRes.targetChar as any)) {
          return "[combat] You cannot see that target.";
        }

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

      const gateErr = applyGates();


      if (gateErr) return gateErr;

      // Hostile commit breaks stealth to prevent threat/assist leakage.
      if ((npc || playerTarget) && isStealthedForCombat(char)) {
        breakStealthForCombat(char);
      }

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

      const gateErr = applyGates();


      if (gateErr) return gateErr;
      const baseHeal = spell.healAmount ?? 10;
      let heal = baseHeal;

      // Songs: scale healing from instrument/vocal skill + optional equipped instrument bonus
      if (isSong && songSchool) {
        const scalar = computeSongScalar(char, songSchool, instrumentBonusPct);
        heal = Math.floor(baseHeal * scalar);
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

      const gateErr = applyGates();


      if (gateErr) return gateErr;
      const baseHeal = Math.max(0, Math.floor(spell.healAmount ?? 0));
      if (baseHeal <= 0) return "[world] That spell has no healing effect.";

      let heal = baseHeal;
      if (isSong && songSchool) {
        const scalar = computeSongScalar(char, songSchool, instrumentBonusPct);
        heal = Math.floor(baseHeal * scalar);
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


    case "heal_hot_self": {
      const seRes = spellStatusEffectOrErr(spell);

      if (!seRes.ok) return seRes.err;


      const gateErr = applyGates();

      if (gateErr) return gateErr;
      const hot = (seRes.se as any).hot;
      if (!hot || typeof hot !== "object") {
        return `[world] [spell:${spell.name}] That spell has no HOT definition.`;
      }

      const tickIntervalMs = Math.max(1, Math.floor(Number(hot.tickIntervalMs ?? 2000)));
      const perTickHeal = Math.max(1, Math.floor(Number(hot.perTickHeal ?? 1)));
applyStatusEffect(char, {
        id: seRes.se.id,
        sourceKind: spell.isSong ? "song" : "spell",
        sourceId: spell.id,
        stackingPolicy: seRes.se.stackingPolicy,
        stackingGroupId: seRes.se.stackingGroupId,
        appliedByKind: "character",
        appliedById: char.id,
        name: seRes.se.name ?? spell.name,
        durationMs: seRes.se.durationMs,
        maxStacks: seRes.se.maxStacks,
        initialStacks: seRes.se.stacks ?? 1,
        modifiers: seRes.se.modifiers ?? {},
        tags: seRes.se.tags,
        hot: { tickIntervalMs, perTickHeal },
      });

      applySchoolGains();
      return `[world] [spell:${spell.name}] You begin regenerating health.`;
    }

    case "heal_hot_single_ally": {
      if (!ctx.entities) return "[world] Entities not available.";
      if (!ctx.sessions) return "[world] Sessions not available.";

      const res = resolvePlayerTargetInRoom(ctx, roomId, targetRaw);
      if ("err" in res) return res.err;

      const seRes = spellStatusEffectOrErr(spell);


      if (!seRes.ok) return seRes.err;



      const gateErr = applyGates();


      if (gateErr) return gateErr;
      const hot = (seRes.se as any).hot;
      if (!hot || typeof hot !== "object") {
        return `[world] [spell:${spell.name}] That spell has no HOT definition.`;
      }

      const tickIntervalMs = Math.max(1, Math.floor(Number(hot.tickIntervalMs ?? 2000)));
      const perTickHeal = Math.max(1, Math.floor(Number(hot.perTickHeal ?? 1)));
applyStatusEffect(res.char, {
        id: seRes.se.id,
        sourceKind: spell.isSong ? "song" : "spell",
        sourceId: spell.id,
        stackingPolicy: seRes.se.stackingPolicy,
        stackingGroupId: seRes.se.stackingGroupId,
        appliedByKind: "character",
        appliedById: char.id,
        name: seRes.se.name ?? spell.name,
        durationMs: seRes.se.durationMs,
        maxStacks: seRes.se.maxStacks,
        initialStacks: seRes.se.stacks ?? 1,
        modifiers: seRes.se.modifiers ?? {},
        tags: seRes.se.tags,
        hot: { tickIntervalMs, perTickHeal },
      });

      applySchoolGains();
      return `[world] [spell:${spell.name}] You weave regeneration onto ${res.displayName}.`;
    }

    case "shield_self": {
      const seRes = spellStatusEffectOrErr(spell);

      if (!seRes.ok) return seRes.err;


      const gateErr = applyGates();

      if (gateErr) return gateErr;
      const absorb = (seRes.se as any).absorb;
      if (!absorb || typeof absorb !== "object") {
        return `[world] [spell:${spell.name}] That spell has no shield definition.`;
      }

      const amount = Math.max(0, Math.floor(Number(absorb.amount ?? 0)));
      if (amount <= 0) return `[world] [spell:${spell.name}] That shield has no strength.`;
applyStatusEffect(char, {
        id: seRes.se.id,
        sourceKind: spell.isSong ? "song" : "spell",
        sourceId: spell.id,
        stackingPolicy: seRes.se.stackingPolicy,
        stackingGroupId: seRes.se.stackingGroupId,
        appliedByKind: "character",
        appliedById: char.id,
        name: seRes.se.name ?? spell.name,
        durationMs: seRes.se.durationMs,
        maxStacks: seRes.se.maxStacks,
        initialStacks: seRes.se.stacks ?? 1,
        modifiers: seRes.se.modifiers ?? {},
        tags: seRes.se.tags,
        absorb: { amount, schools: Array.isArray(absorb.schools) ? absorb.schools : undefined },
      });

      applySchoolGains();
      return `[world] [spell:${spell.name}] A shimmering ward surrounds you.`;
    }

    case "shield_single_ally": {
      if (!ctx.entities) return "[world] Entities not available.";
      if (!ctx.sessions) return "[world] Sessions not available.";

      const res = resolvePlayerTargetInRoom(ctx, roomId, targetRaw);
      if ("err" in res) return res.err;

      const seRes = spellStatusEffectOrErr(spell);


      if (!seRes.ok) return seRes.err;



      const gateErr = applyGates();


      if (gateErr) return gateErr;
      const absorb = (seRes.se as any).absorb;
      if (!absorb || typeof absorb !== "object") {
        return `[world] [spell:${spell.name}] That spell has no shield definition.`;
      }

      const amount = Math.max(0, Math.floor(Number(absorb.amount ?? 0)));
      if (amount <= 0) return `[world] [spell:${spell.name}] That shield has no strength.`;
applyStatusEffect(res.char, {
        id: seRes.se.id,
        sourceKind: spell.isSong ? "song" : "spell",
        sourceId: spell.id,
        stackingPolicy: seRes.se.stackingPolicy,
        stackingGroupId: seRes.se.stackingGroupId,
        appliedByKind: "character",
        appliedById: char.id,
        name: seRes.se.name ?? spell.name,
        durationMs: seRes.se.durationMs,
        maxStacks: seRes.se.maxStacks,
        initialStacks: seRes.se.stacks ?? 1,
        modifiers: seRes.se.modifiers ?? {},
        tags: seRes.se.tags,
        absorb: { amount, schools: Array.isArray(absorb.schools) ? absorb.schools : undefined },
      });

      applySchoolGains();
      return `[world] [spell:${spell.name}] A ward settles over ${res.displayName}.`;
    }

    case "cleanse_self": {
      const gateErr = applyGates();

      if (gateErr) return gateErr;
      const cleanse = (spell as any).cleanse;
      if (!cleanse || !Array.isArray(cleanse.tags) || cleanse.tags.length <= 0) {
        return `[world] [spell:${spell.name}] That spell has no cleanse definition.`;
      }
const removed = clearStatusEffectsByTags(char, cleanse.tags, cleanse.maxToRemove);
      applySchoolGains();

      if (removed <= 0) {
        return `[world] [spell:${spell.name}] Nothing clings to you.`;
      }
      return `[world] [spell:${spell.name}] You cleanse ${removed} effect(s).`;
    }

    case "cleanse_single_ally": {
      if (!ctx.entities) return "[world] Entities not available.";
      if (!ctx.sessions) return "[world] Sessions not available.";

      const res = resolvePlayerTargetInRoom(ctx, roomId, targetRaw);
      if ("err" in res) return res.err;

      const gateErr = applyGates();


      if (gateErr) return gateErr;
      const cleanse = (spell as any).cleanse;
      if (!cleanse || !Array.isArray(cleanse.tags) || cleanse.tags.length <= 0) {
        return `[world] [spell:${spell.name}] That spell has no cleanse definition.`;
      }
const removed = clearStatusEffectsByTags(res.char, cleanse.tags, cleanse.maxToRemove);
      applySchoolGains();

      if (removed <= 0) {
        return `[world] [spell:${spell.name}] ${res.displayName} has nothing to cleanse.`;
      }
      return `[world] [spell:${spell.name}] You cleanse ${removed} effect(s) from ${res.displayName}.`;
    }


    case "buff_self": {
      const seRes = spellStatusEffectOrErr(spell);

      if (!seRes.ok) return seRes.err;


      const gateErr = applyGates();

      if (gateErr) return gateErr;
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

      const seRes = spellStatusEffectOrErr(spell);


      if (!seRes.ok) return seRes.err;



      const gateErr = applyGates();


      if (gateErr) return gateErr;
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
        const denyToken = targetRaw || targetName;
        return `[world] No such target: '${denyToken}'.`;
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

      const gateErr = applyGates();


      if (gateErr) return gateErr;
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