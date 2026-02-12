// worldcore/ranks/RankKillGrantService.ts
//
// Rank system v0.2:
// - Evaluate DB-driven kill-milestone grants for spells/abilities.
// - Grants are applied as *pending* (visit a trainer to learn higher ranks).
// - Safe by default: if DB tables are missing or query fails, behavior is a no-op.

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

import type { MudContext } from "../mud/MudContext";
import type { CharacterState } from "../characters/CharacterTypes";

import { ensureProgression } from "../progression/ProgressionCore";
import { grantSpellInState } from "../spells/SpellLearning";
import { grantAbilityInState } from "../abilities/AbilityLearning";
import { getSpellByIdOrAlias } from "../spells/SpellTypes";
import { findAbilityByNameOrId } from "../abilities/AbilityTypes";

type SpellKillGrantRow = {
  target_proto_id: string;
  required_kills: number;
  spell_id: string;
  source: string | null;
};

type AbilityKillGrantRow = {
  target_proto_id: string;
  required_kills: number;
  ability_id: string;
  source: string | null;
};

const log = Logger.scope("RANK_KILL_GRANTS");

let cacheAt = 0;
let cachedSpells: SpellKillGrantRow[] = [];
let cachedAbilities: AbilityKillGrantRow[] = [];

const CACHE_TTL_MS = 15_000;

function safeNow(nowMs?: number): number {
  const n = Number(nowMs);
  return Number.isFinite(n) ? n : Date.now();
}

async function loadRulesFromDb(nowMs: number): Promise<void> {
  if (nowMs - cacheAt < CACHE_TTL_MS) return;

  cacheAt = nowMs;
  cachedSpells = [];
  cachedAbilities = [];

  try {
    const sRes = await db.query(
      `SELECT target_proto_id, required_kills, spell_id, source
       FROM spell_kill_grants
       WHERE is_enabled = TRUE`
    );
    cachedSpells = (sRes?.rows ?? []) as SpellKillGrantRow[];
  } catch (err) {
    // Tables may not exist in tests/dev; treat as disabled.
    log.debug("spell_kill_grants query failed (treated as empty)", { err });
    cachedSpells = [];
  }

  try {
    const aRes = await db.query(
      `SELECT target_proto_id, required_kills, ability_id, source
       FROM ability_kill_grants
       WHERE is_enabled = TRUE`
    );
    cachedAbilities = (aRes?.rows ?? []) as AbilityKillGrantRow[];
  } catch (err) {
    log.debug("ability_kill_grants query failed (treated as empty)", { err });
    cachedAbilities = [];
  }
}

function normalizeProtoId(protoId: string): string {
  return String(protoId ?? "").trim();
}

function normalizeCount(n: any, fallback = 0): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return x;
}

function grantFlagKey(kind: "spell" | "ability", targetProtoId: string, id: string): string {
  // Keep this stable; it becomes persistent player state.
  return `rank_grant:kill:${kind}:${targetProtoId}:${id}`;
}

export async function applyRankKillGrantsForKill(
  ctx: MudContext,
  char: CharacterState,
  targetProtoIdRaw: string,
  nowMs?: number
): Promise<{ snippets: string[] }> {
  const now = safeNow(nowMs);
  const targetProtoId = normalizeProtoId(targetProtoIdRaw);
  if (!targetProtoId) return { snippets: [] };

  await loadRulesFromDb(now);

  if (cachedSpells.length === 0 && cachedAbilities.length === 0) {
    return { snippets: [] };
  }

  const prog = ensureProgression(char);
  const killsMap = (prog.kills as Record<string, number>) || {};
  const killCount = normalizeCount(killsMap[targetProtoId], 0);

  // We store one-time grant guards under progression.flags.
  const flags = (prog.flags ||= {} as any) as Record<string, any>;

  const snippets: string[] = [];
  let changedSpellbook = false;
  let changedAbilities = false;
  let changedProgression = false;

  // Spells
  for (const r of cachedSpells) {
    const proto = normalizeProtoId(r.target_proto_id);
    if (proto !== targetProtoId) continue;

    const required = Math.max(1, normalizeCount(r.required_kills, 1));
    if (killCount < required) continue;

    const spellId = String(r.spell_id ?? "").trim();
    if (!spellId) continue;

    const key = grantFlagKey("spell", targetProtoId, spellId);
    if (flags[key]) continue;

    const res = grantSpellInState(char, spellId, r.source ?? `kill:${targetProtoId}`);
    if ((res as any)?.ok) {
      char = (res as any).next;
      changedSpellbook = true;
      flags[key] = now;
      changedProgression = true;

      const def = getSpellByIdOrAlias(spellId);
      snippets.push(`[spell] You earned: ${def?.name ?? spellId}. (Train to learn higher ranks.)`);
    }
  }

  // Abilities
  for (const r of cachedAbilities) {
    const proto = normalizeProtoId(r.target_proto_id);
    if (proto !== targetProtoId) continue;

    const required = Math.max(1, normalizeCount(r.required_kills, 1));
    if (killCount < required) continue;

    const abilityId = String(r.ability_id ?? "").trim();
    if (!abilityId) continue;

    const key = grantFlagKey("ability", targetProtoId, abilityId);
    if (flags[key]) continue;

    const res = grantAbilityInState(char, abilityId, r.source ?? `kill:${targetProtoId}`);
    if ((res as any)?.ok) {
      char = (res as any).next;
      changedAbilities = true;
      flags[key] = now;
      changedProgression = true;

      const def = findAbilityByNameOrId(abilityId);
      snippets.push(`[ability] You earned: ${def?.name ?? abilityId}. (Train to learn higher ranks.)`);
    }
  }

  if ((changedSpellbook || changedAbilities || changedProgression) && ctx.characters) {
    try {
      await ctx.characters.patchCharacter(char.userId, char.id, {
        spellbook: changedSpellbook ? (char as any).spellbook : undefined,
        abilities: changedAbilities ? (char as any).abilities : undefined,
        progression: changedProgression ? (char as any).progression : undefined,
      } as any);
    } catch (err) {
      // Don't break combat.
      // eslint-disable-next-line no-console
      console.warn("applyRankKillGrantsForKill: patchCharacter failed", {
        err,
        charId: char.id,
        targetProtoId,
      });
    }
  }

  return { snippets };
}
