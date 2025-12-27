// worldcore/quests/PostgresQuestService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import type { QuestService } from "./QuestService";
import type {
  QuestDefinition,
  QuestObjective,
  QuestReward,
} from "./QuestTypes";

const log = Logger.scope("QUESTS");

interface QuestRow {
  id: string;
  name: string;
  description: string;
  repeatable: boolean;
  max_repeats: number | null;
  is_enabled: boolean;
}

interface ObjectiveRow {
  id: number;
  quest_id: string;
  idx: number;
  kind: string;       // 'kill' | 'harvest' | 'collect_item' | 'craft' | 'city' | 'talk_to'
  target_id: string;  // maps to targetProtoId / nodeProtoId / itemId / actionId / cityActionId
  required: number;
  extra_json: any | null;
}

interface RewardRow {
  id: number;
  quest_id: string;
  kind: string;        // 'xp' | 'gold' | 'item' | 'title'
  amount: number | null;
  item_id: string | null;
  item_qty: number | null;
  title_id: string | null;
  extra_json: any | null;
}

export class PostgresQuestService implements QuestService {
  async listQuests(): Promise<QuestDefinition[]> {
    const qRes = await db.query<QuestRow>(
      `SELECT id, name, description, repeatable, max_repeats, is_enabled
       FROM quests
       WHERE is_enabled = TRUE
       ORDER BY id ASC`
    );

    if (qRes.rowCount === 0) return [];

    const ids = qRes.rows.map((r) => r.id);

    const [oRes, rRes] = await Promise.all([
      db.query<ObjectiveRow>(
        `SELECT id, quest_id, idx, kind, target_id, required, extra_json
         FROM quest_objectives
         WHERE quest_id = ANY($1)
         ORDER BY quest_id, idx ASC`,
        [ids]
      ),
      db.query<RewardRow>(
        `SELECT id, quest_id, kind, amount, item_id, item_qty, title_id, extra_json
         FROM quest_rewards
         WHERE quest_id = ANY($1)
         ORDER BY quest_id, id ASC`,
        [ids]
      ),
    ]);

    const objectivesByQuest = new Map<string, QuestObjective[]>();
    for (const row of oRes.rows) {
      const list = objectivesByQuest.get(row.quest_id) ?? [];
      list.push(mapObjectiveRow(row));
      objectivesByQuest.set(row.quest_id, list);
    }

    const rewardByQuest = new Map<string, QuestReward>();
    for (const row of rRes.rows) {
      const existing = rewardByQuest.get(row.quest_id) ?? ({
        xp: 0,
        gold: 0,
        items: [],
        titles: [],
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
        default:
          log.warn("Unknown quest reward kind from DB", {
            questId: row.quest_id,
            kind: row.kind,
          });
      }

      rewardByQuest.set(row.quest_id, existing);
    }

    const defs: QuestDefinition[] = [];

    for (const row of qRes.rows) {
      const objectives = objectivesByQuest.get(row.id) ?? [];
      const rewardRaw = rewardByQuest.get(row.id);

      // Clean up empty reward bags
      let reward: QuestReward | undefined = rewardRaw;
      if (rewardRaw) {
        const hasXp = !!rewardRaw.xp;
        const hasGold = !!rewardRaw.gold;
        const hasItems = !!rewardRaw.items && rewardRaw.items.length > 0;
        const hasTitles = !!rewardRaw.titles && rewardRaw.titles.length > 0;
        if (!hasXp && !hasGold && !hasItems && !hasTitles) {
          reward = undefined;
        }
      }

      defs.push({
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        objectives,
        reward,
        repeatable: row.repeatable,
        maxCompletions: row.max_repeats ?? undefined,
      });
    }

    return defs;
  }

  async getQuest(id: string): Promise<QuestDefinition | null> {
    const res = await db.query<QuestRow>(
      `SELECT id, name, description, repeatable, max_repeats, is_enabled
       FROM quests
       WHERE id = $1
         AND is_enabled = TRUE`,
      [id]
    );

    if (res.rowCount === 0) return null;

    const row = res.rows[0];

    const [oRes, rRes] = await Promise.all([
      db.query<ObjectiveRow>(
        `SELECT id, quest_id, idx, kind, target_id, required, extra_json
         FROM quest_objectives
         WHERE quest_id = $1
         ORDER BY idx ASC`,
        [row.id]
      ),
      db.query<RewardRow>(
        `SELECT id, quest_id, kind, amount, item_id, item_qty, title_id, extra_json
         FROM quest_rewards
         WHERE quest_id = $1
         ORDER BY id ASC`,
        [row.id]
      ),
    ]);

    const objectives = oRes.rows.map(mapObjectiveRow);

    let reward: QuestReward | undefined;

    // Normalize to a non-null array so TS chills out
    const rewardRows = rRes?.rows ?? [];
    
    if (rewardRows.length > 0) {
      const bag: QuestReward = { xp: 0, gold: 0, items: [], titles: [] };
    
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
      if (hasXp || hasGold || hasItems || hasTitles) {
        reward = bag;
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      objectives,
      reward,
      repeatable: row.repeatable,
      maxCompletions: row.max_repeats ?? undefined,
    };
  }
}

function mapObjectiveRow(row: ObjectiveRow): QuestObjective {
  switch (row.kind) {
    case "kill":
      return {
        kind: "kill",
        targetProtoId: row.target_id,
        required: row.required,
      };
    case "harvest":
      return {
        kind: "harvest",
        nodeProtoId: row.target_id,
        required: row.required,
      };
    case "collect_item":
    case "item_turnin":
      return {
        kind: "collect_item",
        itemId: row.target_id,
        required: row.required,
      };
    case "craft":
      return {
        kind: "craft",
        actionId: row.target_id,
        required: row.required,
      };
    case "city":
      return {
        kind: "city",
        cityActionId: row.target_id,
        required: row.required,
      };
    // NEW: talk_to
    case "talk_to":
      return {
        kind: "talk_to",
        npcId: row.target_id,
        required: row.required,
      };
    default:
      // Fallback: treat unknown types as a generic action objective
      return {
        kind: "craft",
        actionId: row.target_id,
        required: row.required,
      };
  }
}
