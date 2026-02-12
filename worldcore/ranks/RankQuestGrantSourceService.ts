// worldcore/ranks/RankQuestGrantSourceService.ts
//
// Rank system v1.1:
// - Best-effort discovery of quest reward sources for spell/ability rank grants.
// - In production/dev, sources are read from DB (quests + quest_rewards).
// - In tests (WORLDCORE_TEST=1), DB access is blocked; env rules can be used.
//
// Env override (useful for tests / quick tuning):
//   PW_RANK_QUEST_GRANTS_JSON='{"spells":[{"questId":"q1","questName":"Quest One","spellId":"arcane_bolt_ii"}],"abilities":[]}'

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

export type RankQuestGrantSource = {
  questId: string;
  questName?: string | null;
  source?: string | null;
};

type EnvSpellRule = { questId: string; questName?: string; spellId: string; source?: string };
type EnvAbilityRule = { questId: string; questName?: string; abilityId: string; source?: string };

type DbSpellRow = { quest_id: string; quest_name: string | null; source: string | null };
type DbAbilityRow = { quest_id: string; quest_name: string | null; source: string | null };

const log = Logger.scope("RANK_QUEST_SOURCES");

let cacheAt = 0;
let cachedSpellSourcesBySpellId = new Map<string, RankQuestGrantSource[]>();
let cachedAbilitySourcesByAbilityId = new Map<string, RankQuestGrantSource[]>();

const CACHE_TTL_MS = 15_000;

function safeNow(nowMs?: number): number {
  const n = Number(nowMs);
  return Number.isFinite(n) ? n : Date.now();
}

function normId(x: unknown): string {
  return String(x ?? "").trim();
}

function parseEnvRules(): { usedEnvRules: boolean; spells: EnvSpellRule[]; abilities: EnvAbilityRule[] } {
  const raw = process.env.PW_RANK_QUEST_GRANTS_JSON;
  if (!raw) return { usedEnvRules: false, spells: [], abilities: [] };

  try {
    const obj = JSON.parse(raw);
    const spellsRaw = Array.isArray(obj?.spells) ? obj.spells : [];
    const abilitiesRaw = Array.isArray(obj?.abilities) ? obj.abilities : [];

    const spells: EnvSpellRule[] = spellsRaw
      .map((r: any) => ({
        questId: normId(r?.questId),
        questName: r?.questName ? String(r.questName) : undefined,
        spellId: normId(r?.spellId),
        source: r?.source ? String(r.source) : undefined,
      }))
      .filter((r: EnvSpellRule) => r.questId && r.spellId);

    const abilities: EnvAbilityRule[] = abilitiesRaw
      .map((r: any) => ({
        questId: normId(r?.questId),
        questName: r?.questName ? String(r.questName) : undefined,
        abilityId: normId(r?.abilityId),
        source: r?.source ? String(r.source) : undefined,
      }))
      .filter((r: EnvAbilityRule) => r.questId && r.abilityId);

    return { usedEnvRules: true, spells, abilities };
  } catch (err) {
    log.warn("PW_RANK_QUEST_GRANTS_JSON parse failed (ignored)", { err });
    return { usedEnvRules: false, spells: [], abilities: [] };
  }
}

async function loadFromDb(now: number): Promise<void> {
  if (now - cacheAt < CACHE_TTL_MS) return;

  cacheAt = now;
  cachedSpellSourcesBySpellId = new Map();
  cachedAbilitySourcesByAbilityId = new Map();

  try {
    const sRes = await db.query(
      `SELECT q.id AS quest_id, q.name AS quest_name, (qr.extra_json->>'source') AS source,
              (qr.extra_json->>'spellId') AS spell_id
       FROM quest_rewards qr
       JOIN quests q ON q.id = qr.quest_id
       WHERE qr.kind = 'spell_grant'
         AND q.is_enabled = TRUE`
    );

    for (const row of (sRes?.rows ?? []) as any[]) {
      const spellId = normId(row?.spell_id);
      const questId = normId(row?.quest_id);
      if (!spellId || !questId) continue;
      const list = cachedSpellSourcesBySpellId.get(spellId) ?? [];
      list.push({ questId, questName: row?.quest_name ?? null, source: row?.source ?? null });
      cachedSpellSourcesBySpellId.set(spellId, list);
    }
  } catch (err) {
    log.debug("quest spell_grant source query failed (treated as empty)", { err });
    cachedSpellSourcesBySpellId = new Map();
  }

  try {
    const aRes = await db.query(
      `SELECT q.id AS quest_id, q.name AS quest_name, (qr.extra_json->>'source') AS source,
              (qr.extra_json->>'abilityId') AS ability_id
       FROM quest_rewards qr
       JOIN quests q ON q.id = qr.quest_id
       WHERE qr.kind = 'ability_grant'
         AND q.is_enabled = TRUE`
    );

    for (const row of (aRes?.rows ?? []) as any[]) {
      const abilityId = normId(row?.ability_id);
      const questId = normId(row?.quest_id);
      if (!abilityId || !questId) continue;
      const list = cachedAbilitySourcesByAbilityId.get(abilityId) ?? [];
      list.push({ questId, questName: row?.quest_name ?? null, source: row?.source ?? null });
      cachedAbilitySourcesByAbilityId.set(abilityId, list);
    }
  } catch (err) {
    log.debug("quest ability_grant source query failed (treated as empty)", { err });
    cachedAbilitySourcesByAbilityId = new Map();
  }
}

export async function listQuestRewardSourcesForSpellId(
  spellIdRaw: string,
  nowMs?: number
): Promise<{ sources: RankQuestGrantSource[]; usedEnvRules: boolean }> {
  const spellId = normId(spellIdRaw);
  if (!spellId) return { sources: [], usedEnvRules: false };

  const env = parseEnvRules();
  if (env.usedEnvRules) {
    const sources = env.spells
      .filter((r) => r.spellId === spellId)
      .map((r) => ({ questId: r.questId, questName: r.questName ?? null, source: r.source ?? null }));
    return { sources, usedEnvRules: true };
  }

  if (process.env.WORLDCORE_TEST === "1") return { sources: [], usedEnvRules: false };

  const now = safeNow(nowMs);
  await loadFromDb(now);
  return { sources: cachedSpellSourcesBySpellId.get(spellId) ?? [], usedEnvRules: false };
}

export async function listQuestRewardSourcesForAbilityId(
  abilityIdRaw: string,
  nowMs?: number
): Promise<{ sources: RankQuestGrantSource[]; usedEnvRules: boolean }> {
  const abilityId = normId(abilityIdRaw);
  if (!abilityId) return { sources: [], usedEnvRules: false };

  const env = parseEnvRules();
  if (env.usedEnvRules) {
    const sources = env.abilities
      .filter((r) => r.abilityId === abilityId)
      .map((r) => ({ questId: r.questId, questName: r.questName ?? null, source: r.source ?? null }));
    return { sources, usedEnvRules: true };
  }

  if (process.env.WORLDCORE_TEST === "1") return { sources: [], usedEnvRules: false };

  const now = safeNow(nowMs);
  await loadFromDb(now);
  return { sources: cachedAbilitySourcesByAbilityId.get(abilityId) ?? [], usedEnvRules: false };
}
