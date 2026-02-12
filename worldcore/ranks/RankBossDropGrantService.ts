// worldcore/ranks/RankBossDropGrantService.ts
//
// Rank system v0.3:
// - Boss drop grants for spells/abilities.
// - On killing a specific NPC proto, we roll a chance to GRANT (pending training)
//   a spell/ability rank. This is *not* auto-learned; player must /train.
//
// Design constraints:
// - Unit tests run with WORLDCORE_TEST=1, where DB access is blocked.
//   So we support an env-only rules source (PW_RANK_BOSS_DROPS_JSON).
// - In production/dev, rules can be loaded from Postgres tables:
//     spell_boss_drops / ability_boss_drops
//
// Env rules shape (JSON):
// {
//   "spells": [{ "npcProtoId": "bandit_boss", "spellId": "archmage_arcane_bolt_ii", "chance": 0.25, "source": "boss_drop" }],
//   "abilities": [{ "npcProtoId": "bandit_boss", "abilityId": "crusader_shield_bash_ii", "chance": 0.10 }]
// }

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

import type { MudContext } from "../mud/MudContext";
import type { CharacterState } from "../characters/CharacterTypes";

import { ensureProgression } from "../progression/ProgressionCore";
import { grantSpellInState } from "../spells/SpellLearning";
import { grantAbilityInState } from "../abilities/AbilityLearning";
import { getSpellByIdOrAlias } from "../spells/SpellTypes";
import { findAbilityByNameOrId } from "../abilities/AbilityTypes";

type SpellBossDropRow = {
  npc_proto_id: string;
  chance: number;
  spell_id: string;
  source: string | null;
};

type AbilityBossDropRow = {
  npc_proto_id: string;
  chance: number;
  ability_id: string;
  source: string | null;
};

type EnvRule = {
  npcProtoId: string;
  chance: number;
  spellId?: string;
  abilityId?: string;
  source?: string;
};

const log = Logger.scope("RANK_BOSS_DROPS");

let cacheAt = 0;
let cachedSpells: SpellBossDropRow[] = [];
let cachedAbilities: AbilityBossDropRow[] = [];
let cachedFromEnv = false;

const CACHE_TTL_MS = 15_000;

function safeNow(nowMs?: number): number {
  const n = Number(nowMs);
  return Number.isFinite(n) ? n : Date.now();
}

function normalizeProtoId(protoId: string): string {
  return String(protoId ?? "").trim();
}

function normalizeChance(v: any, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  // Clamp to sane range.
  return Math.max(0, Math.min(1, n));
}

function grantFlagKey(kind: "spell" | "ability", npcProtoId: string, id: string): string {
  // Keep stable; persists in progression.flags.
  return `rank_grant:drop:${kind}:${npcProtoId}:${id}`;
}

function tryLoadRulesFromEnv(): { spells: SpellBossDropRow[]; abilities: AbilityBossDropRow[] } | null {
  const raw = process.env.PW_RANK_BOSS_DROPS_JSON;
  if (!raw || !String(raw).trim()) return null;

  try {
    const parsed = JSON.parse(String(raw));
    const spells: SpellBossDropRow[] = [];
    const abilities: AbilityBossDropRow[] = [];

    const s: EnvRule[] = Array.isArray(parsed?.spells) ? parsed.spells : [];
    const a: EnvRule[] = Array.isArray(parsed?.abilities) ? parsed.abilities : [];

    for (const r of s) {
      const npcProtoId = normalizeProtoId((r as any)?.npcProtoId);
      const spellId = String((r as any)?.spellId ?? "").trim();
      const chance = normalizeChance((r as any)?.chance, 0);
      if (!npcProtoId || !spellId || chance <= 0) continue;
      spells.push({ npc_proto_id: npcProtoId, chance, spell_id: spellId, source: (r as any)?.source ?? null });
    }

    for (const r of a) {
      const npcProtoId = normalizeProtoId((r as any)?.npcProtoId);
      const abilityId = String((r as any)?.abilityId ?? "").trim();
      const chance = normalizeChance((r as any)?.chance, 0);
      if (!npcProtoId || !abilityId || chance <= 0) continue;
      abilities.push({
        npc_proto_id: npcProtoId,
        chance,
        ability_id: abilityId,
        source: (r as any)?.source ?? null,
      });
    }

    return { spells, abilities };
  } catch (err) {
    log.warn("PW_RANK_BOSS_DROPS_JSON failed to parse; treating as empty", { err });
    return { spells: [], abilities: [] };
  }
}

async function loadRules(nowMs: number): Promise<void> {
  if (nowMs - cacheAt < CACHE_TTL_MS) return;

  cacheAt = nowMs;
  cachedSpells = [];
  cachedAbilities = [];
  cachedFromEnv = false;

  // 1) Env rules win (unit-test safe and lets you hot tune quickly).
  const envRules = tryLoadRulesFromEnv();
  if (envRules) {
    cachedSpells = envRules.spells;
    cachedAbilities = envRules.abilities;
    cachedFromEnv = true;
    return;
  }

  // 2) DB rules (best-effort, no-op if missing).
  try {
    const sRes = await db.query(
      `SELECT npc_proto_id, chance, spell_id, source
       FROM spell_boss_drops
       WHERE is_enabled = TRUE`
    );
    cachedSpells = (sRes?.rows ?? []) as SpellBossDropRow[];
  } catch (err) {
    log.debug("spell_boss_drops query failed (treated as empty)", { err });
    cachedSpells = [];
  }

  try {
    const aRes = await db.query(
      `SELECT npc_proto_id, chance, ability_id, source
       FROM ability_boss_drops
       WHERE is_enabled = TRUE`
    );
    cachedAbilities = (aRes?.rows ?? []) as AbilityBossDropRow[];
  } catch (err) {
    log.debug("ability_boss_drops query failed (treated as empty)", { err });
    cachedAbilities = [];
  }
}

export async function applyRankBossDropGrantsForKill(
  ctx: MudContext,
  char: CharacterState,
  npcProtoIdRaw: string,
  nowMs?: number,
): Promise<{ snippets: string[]; usedEnvRules?: boolean }> {
  const now = safeNow(nowMs);
  const npcProtoId = normalizeProtoId(npcProtoIdRaw);
  if (!npcProtoId) return { snippets: [] };

  await loadRules(now);
  if (cachedSpells.length === 0 && cachedAbilities.length === 0) return { snippets: [] };

  const prog = ensureProgression(char);
  const flags = (prog.flags ||= {} as any) as Record<string, any>;

  const snippets: string[] = [];
  let changedSpellbook = false;
  let changedAbilities = false;
  let changedProgression = false;

  // Spells
  for (const r of cachedSpells) {
    const proto = normalizeProtoId(r.npc_proto_id);
    if (proto !== npcProtoId) continue;

    const chance = normalizeChance(r.chance, 0);
    if (chance <= 0) continue;

    const spellId = String(r.spell_id ?? "").trim();
    if (!spellId) continue;

    const key = grantFlagKey("spell", npcProtoId, spellId);
    if (flags[key]) continue;

    if (Math.random() > chance) continue;

    const res = grantSpellInState(char, spellId, r.source ?? `drop:${npcProtoId}`);
    if ((res as any)?.ok) {
      // IMPORTANT: mutate in-place so callers holding references (session.character) see the update.
      (char as any).spellbook = (res as any).next.spellbook;
      changedSpellbook = true;
      flags[key] = now;
      changedProgression = true;

      const def = getSpellByIdOrAlias(spellId);
      snippets.push(`[spell] You found a forgotten technique: ${def?.name ?? spellId}. (Train to learn.)`);
    }
  }

  // Abilities
  for (const r of cachedAbilities) {
    const proto = normalizeProtoId(r.npc_proto_id);
    if (proto !== npcProtoId) continue;

    const chance = normalizeChance(r.chance, 0);
    if (chance <= 0) continue;

    const abilityId = String(r.ability_id ?? "").trim();
    if (!abilityId) continue;

    const key = grantFlagKey("ability", npcProtoId, abilityId);
    if (flags[key]) continue;

    if (Math.random() > chance) continue;

    const res = grantAbilityInState(char, abilityId, r.source ?? `drop:${npcProtoId}`);
    if ((res as any)?.ok) {
      (char as any).abilities = (res as any).next.abilities;
      changedAbilities = true;
      flags[key] = now;
      changedProgression = true;

      const def = findAbilityByNameOrId(abilityId);
      snippets.push(`[ability] You found a combat doctrine: ${def?.name ?? abilityId}. (Train to learn.)`);
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
      // Never break combat flow.
      // eslint-disable-next-line no-console
      console.warn("applyRankBossDropGrantsForKill: patchCharacter failed", {
        err,
        charId: char.id,
        npcProtoId,
      });
    }
  }

  return { snippets, usedEnvRules: cachedFromEnv };
}
