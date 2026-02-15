// worldcore/quests/PostgresQuestService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import type { QuestService } from "./QuestService";
import type { QuestDefinition, QuestObjective, QuestReward } from "./QuestTypes";

const log = Logger.scope("QUESTS");

interface QuestRow {
  id: string;
  name: string;
  description: string;
  repeatable: boolean;
  max_repeats: number | null;
  is_enabled: boolean;
  turnin_policy?: string | null;
  turnin_npc_id?: string | null;
  turnin_board_id?: string | null;
}

interface ObjectiveRow {
  id: number;
  quest_id: string;
  idx: number;
  kind: string; // 'kill' | 'harvest' | 'collect_item' | 'craft' | 'city' | 'talk_to'
  target_id: string;
  required: number;
  extra_json: any | null;
}

interface RewardRow {
  id: number;
  quest_id: string;
  kind: string; // 'xp' | 'gold' | 'item' | 'title' | 'spell_grant' | 'ability_grant'
  amount: number | null;
  item_id: string | null;
  item_qty: number | null;
  title_id: string | null;
  extra_json: any | null;
}

export class PostgresQuestService implements QuestService {
  async listQuests(): Promise<QuestDefinition[]> {
    // NOTE: Do NOT use db.query<QuestRow>(...) generics here.
    // Some runtimes/tests stub db.query as untyped, which breaks TS compilation.
    const qRes = await db.query(
      `SELECT id, name, description, repeatable, max_repeats, is_enabled,
              turnin_policy, turnin_npc_id, turnin_board_id
       FROM quests
       WHERE is_enabled = TRUE
       ORDER BY id ASC`
    );

    if (!qRes.rowCount) return [];

    const questRows = (qRes.rows ?? []) as QuestRow[];
    const ids = questRows.map((r: QuestRow) => r.id);

    const [oRes, rRes] = await Promise.all([
      db.query(
        `SELECT id, quest_id, idx, kind, target_id, required, extra_json
         FROM quest_objectives
         WHERE quest_id = ANY($1)
         ORDER BY quest_id, idx ASC`,
        [ids]
      ),
      db.query(
        `SELECT id, quest_id, kind, amount, item_id, item_qty, title_id, extra_json
         FROM quest_rewards
         WHERE quest_id = ANY($1)
         ORDER BY quest_id, id ASC`,
        [ids]
      ),
    ]);

    const objectiveRows = ((oRes?.rows ?? []) as ObjectiveRow[]);
    const rewardRows = ((rRes?.rows ?? []) as RewardRow[]);

    const objectivesByQuest = new Map<string, QuestObjective[]>();
    for (const row of objectiveRows) {
      const list = objectivesByQuest.get(row.quest_id) ?? [];
      list.push(mapObjectiveRow(row));
      objectivesByQuest.set(row.quest_id, list);
    }

    const rewardByQuest = new Map<string, QuestReward>();
    for (const row of rewardRows) {
      const existing =
        rewardByQuest.get(row.quest_id) ??
        ({
          xp: 0,
          gold: 0,
          items: [],
          titles: [],
          spellGrants: [],
          abilityGrants: [],
        } as QuestReward);

      switch (row.kind) {
        case "xp":
          existing.xp = (existing.xp ?? 0) + (row.amount ?? 0);
          break;

        case "gold":
          existing.gold = (existing.gold ?? 0) + (row.amount ?? 0);
          break;

        case "item":
          if (row.item_id) {
            if (!existing.items) existing.items = [];
            existing.items.push({
              itemId: row.item_id,
              count: row.item_qty ?? 1,
            });
          }
          break;

        case "title":
          if (row.title_id) {
            if (!existing.titles) existing.titles = [];
            existing.titles.push(row.title_id);
          }
          break;

        case "spell_grant": {
          const spellId = row.extra_json && (row.extra_json as any).spellId ? String((row.extra_json as any).spellId) : null;
          if (spellId) {
            if (!existing.spellGrants) existing.spellGrants = [];
            existing.spellGrants.push({ spellId, source: row.extra_json && (row.extra_json as any).source ? String((row.extra_json as any).source) : undefined });
          }
          break;
        }

        case "ability_grant": {
          const abilityId = row.extra_json && (row.extra_json as any).abilityId ? String((row.extra_json as any).abilityId) : null;
          if (abilityId) {
            if (!existing.abilityGrants) existing.abilityGrants = [];
            existing.abilityGrants.push({ abilityId, source: row.extra_json && (row.extra_json as any).source ? String((row.extra_json as any).source) : undefined });
          }
          break;
        }

        default:
          log.warn("Unknown quest reward kind from DB", {
            questId: row.quest_id,
            kind: row.kind,
          });
      }

      rewardByQuest.set(row.quest_id, existing);
    }

    const defs: QuestDefinition[] = [];

    for (const row of questRows) {
      const objectives = objectivesByQuest.get(row.id) ?? [];
      const rewardRaw = rewardByQuest.get(row.id);

      let reward: QuestReward | undefined = rewardRaw;
      if (rewardRaw) {
        const hasXp = !!rewardRaw.xp;
        const hasGold = !!rewardRaw.gold;
        const hasItems = !!rewardRaw.items && rewardRaw.items.length > 0;
        const hasTitles = !!rewardRaw.titles && rewardRaw.titles.length > 0;
        const hasSpellGrants = !!rewardRaw.spellGrants && rewardRaw.spellGrants.length > 0;
        const hasAbilityGrants = !!rewardRaw.abilityGrants && rewardRaw.abilityGrants.length > 0;
        if (!hasXp && !hasGold && !hasItems && !hasTitles && !hasSpellGrants && !hasAbilityGrants) {
          reward = undefined;
        }
      }

      defs.push({
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        objectives,
        reward,
        turninPolicy: (row.turnin_policy as any) ?? "anywhere",
        turninNpcId: row.turnin_npc_id ?? null,
        turninBoardId: row.turnin_board_id ?? null,
        repeatable: row.repeatable,
        maxCompletions: row.max_repeats ?? undefined,
      });
    }

    return defs;
  }

  async getQuest(id: string): Promise<QuestDefinition | null> {
    const res = await db.query(
      `SELECT id, name, description, repeatable, max_repeats, is_enabled,
              turnin_policy, turnin_npc_id, turnin_board_id
       FROM quests
       WHERE id = $1
         AND is_enabled = TRUE`,
      [id]
    );

    if (!res.rowCount) return null;

    const row = (res.rows?.[0] as QuestRow) ?? null;
    if (!row) return null;

    const [oRes, rRes] = await Promise.all([
      db.query(
        `SELECT id, quest_id, idx, kind, target_id, required, extra_json
         FROM quest_objectives
         WHERE quest_id = $1
         ORDER BY idx ASC`,
        [row.id]
      ),
      db.query(
        `SELECT id, quest_id, kind, amount, item_id, item_qty, title_id, extra_json
         FROM quest_rewards
         WHERE quest_id = $1
         ORDER BY id ASC`,
        [row.id]
      ),
    ]);

    const objectives = (((oRes?.rows ?? []) as ObjectiveRow[]).map(mapObjectiveRow));

    const rewardRows = (rRes?.rows ?? []) as RewardRow[];
    let reward: QuestReward | undefined;

    if (rewardRows.length > 0) {
      const bag: QuestReward = { xp: 0, gold: 0, items: [], titles: [], spellGrants: [], abilityGrants: [] };

      for (const r of rewardRows) {
        switch (r.kind) {
          case "xp":
            bag.xp = (bag.xp ?? 0) + (r.amount ?? 0);
            break;

          case "gold":
            bag.gold = (bag.gold ?? 0) + (r.amount ?? 0);
            break;

          case "item":
            if (r.item_id) {
              bag.items!.push({
                itemId: r.item_id,
                count: r.item_qty ?? 1,
              });
            }
            break;

          case "title":
            if (r.title_id) {
              bag.titles!.push(r.title_id);
            }
            break;

          case "spell_grant": {
            const spellId = r.extra_json && (r.extra_json as any).spellId ? String((r.extra_json as any).spellId) : null;
            if (spellId) {
              bag.spellGrants = (bag.spellGrants ?? []) as any;
              (bag.spellGrants as any).push({ spellId, source: r.extra_json && (r.extra_json as any).source ? String((r.extra_json as any).source) : undefined });
            }
            break;
          }

          case "ability_grant": {
            const abilityId = r.extra_json && (r.extra_json as any).abilityId ? String((r.extra_json as any).abilityId) : null;
            if (abilityId) {
              bag.abilityGrants = (bag.abilityGrants ?? []) as any;
              (bag.abilityGrants as any).push({ abilityId, source: r.extra_json && (r.extra_json as any).source ? String((r.extra_json as any).source) : undefined });
            }
            break;
          }

          default:
            log.warn("Unknown quest reward kind from DB", {
              questId: r.quest_id,
              kind: r.kind,
            });
        }
      }

      const hasXp = !!bag.xp;
      const hasGold = !!bag.gold;
      const hasItems = !!bag.items && bag.items.length > 0;
      const hasTitles = !!bag.titles && bag.titles.length > 0;
      const hasSpellGrants = !!bag.spellGrants && bag.spellGrants.length > 0;
      const hasAbilityGrants = !!bag.abilityGrants && bag.abilityGrants.length > 0;

      if (hasXp || hasGold || hasItems || hasTitles || hasSpellGrants || hasAbilityGrants) {
        reward = bag;
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      objectives,
      reward,
      turninPolicy: (row.turnin_policy as any) ?? "anywhere",
      turninNpcId: row.turnin_npc_id ?? null,
      turninBoardId: row.turnin_board_id ?? null,
      repeatable: row.repeatable,
      maxCompletions: row.max_repeats ?? undefined,
    };
  }
}

function mapObjectiveRow(row: ObjectiveRow): QuestObjective {
  switch (row.kind) {
    case "kill":
      return { kind: "kill", targetProtoId: row.target_id, required: row.required };

    case "harvest":
      return { kind: "harvest", nodeProtoId: row.target_id, required: row.required };

    case "collect_item":
    case "item_turnin":
      return { kind: "collect_item", itemId: row.target_id, required: row.required };

    case "craft":
      return { kind: "craft", actionId: row.target_id, required: row.required };

    case "city":
      return { kind: "city", cityActionId: row.target_id, required: row.required };

    case "talk_to":
      return { kind: "talk_to", npcId: row.target_id, required: row.required };

    default:
      // Safe fallback: treat unknown types as "craft" action objective.
      return { kind: "craft", actionId: row.target_id, required: row.required };
  }
}
