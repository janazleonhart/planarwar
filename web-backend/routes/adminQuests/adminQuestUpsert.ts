// web-backend/routes/adminQuests/adminQuestUpsert.ts

import { db } from "../../../worldcore/db/Database";
import { PostgresQuestService } from "../../../worldcore/quests/PostgresQuestService";
import { setQuestDefinitions } from "../../../worldcore/quests/QuestRegistry";

import type { AdminQuestPayload, NormalizedAdminQuestUpsert, ObjectiveKind } from "./adminQuestTypes";

export type AdminQuestRequestError = {
  status: number;
  error: string;
};

function makeRequestError(status: number, error: string): AdminQuestRequestError {
  return { status, error };
}

export function normalizeAdminQuestPayload(body: Partial<AdminQuestPayload>): NormalizedAdminQuestUpsert | AdminQuestRequestError {
  if (!body.id || !body.name || !body.description || !body.objectiveKind || !body.objectiveTargetId) {
    return makeRequestError(400, "id, name, description, objectiveKind, objectiveTargetId are required");
  }

  const turninPolicyRaw = String((body as any).turninPolicy ?? "anywhere").trim().toLowerCase();
  const turninPolicy: "anywhere" | "board" | "npc" =
    turninPolicyRaw === "board" ? "board" : turninPolicyRaw === "npc" ? "npc" : "anywhere";

  return {
    id: String(body.id).trim(),
    name: String(body.name).trim(),
    description: String(body.description).trim(),
    repeatable: !!body.repeatable,
    maxCompletions: body.maxCompletions === null || body.maxCompletions === undefined ? null : Number(body.maxCompletions),
    turninPolicy,
    turninNpcId: ((body as any).turninNpcId ?? null) ? String((body as any).turninNpcId).trim() : null,
    turninBoardId: ((body as any).turninBoardId ?? null) ? String((body as any).turninBoardId).trim() : null,
    objectiveKind: body.objectiveKind as ObjectiveKind,
    objectiveTargetId: String(body.objectiveTargetId).trim(),
    objectiveRequired: Number(body.objectiveRequired || 1),
    rewardXp: Number(body.rewardXp || 0),
    rewardGold: Number(body.rewardGold || 0),
    rewardItems: (Array.isArray(body.rewardItems) ? body.rewardItems : [])
      .map((it) => ({
        itemId: String((it as any)?.itemId ?? "").trim(),
        count: Number((it as any)?.count ?? 1),
      }))
      .filter((it) => !!it.itemId),
    rewardSpellGrants: (Array.isArray(body.rewardSpellGrants) ? body.rewardSpellGrants : [])
      .map((g) => ({
        spellId: String((g as any)?.spellId ?? "").trim(),
        source: (g as any)?.source ? String((g as any).source).trim() : undefined,
      }))
      .filter((g) => !!g.spellId),
    rewardAbilityGrants: (Array.isArray(body.rewardAbilityGrants) ? body.rewardAbilityGrants : [])
      .map((g) => ({
        abilityId: String((g as any)?.abilityId ?? "").trim(),
        source: (g as any)?.source ? String((g as any).source).trim() : undefined,
      }))
      .filter((g) => !!g.abilityId),
  };
}

export async function validateAdminQuestUpsert(input: NormalizedAdminQuestUpsert): Promise<AdminQuestRequestError | null> {
  try {
    if (input.objectiveKind === "kill" || input.objectiveKind === "talk_to") {
      const npcCheck = await db.query("SELECT 1 FROM npcs WHERE id = $1", [input.objectiveTargetId]);
      if (npcCheck.rowCount === 0) {
        return makeRequestError(400, `NPC '${input.objectiveTargetId}' does not exist. Create it first in the NPC editor.`);
      }
    }

    if (input.objectiveKind === "collect_item") {
      const itemCheck = await db.query("SELECT 1 FROM items WHERE id = $1", [input.objectiveTargetId]);
      if (itemCheck.rowCount === 0) {
        return makeRequestError(400, `Item '${input.objectiveTargetId}' does not exist. Create it first in the item editor.`);
      }
    }

    if (input.rewardItems.length) {
      const ids = Array.from(new Set(input.rewardItems.map((x) => x.itemId)));
      const r = await db.query(`SELECT id FROM items WHERE id = ANY($1::text[])`, [ids]);
      const have = new Set((r.rows as any[]).map((row) => String(row.id)));
      const missing = ids.filter((id) => !have.has(id));
      if (missing.length) {
        return makeRequestError(400, `Reward item(s) do not exist: ${missing.join(", ")}. Create them in the item editor first.`);
      }
    }

    if (input.rewardSpellGrants.length) {
      const ids = Array.from(new Set(input.rewardSpellGrants.map((g) => g.spellId)));
      const r = await db.query(`SELECT id FROM spells WHERE id = ANY($1::text[])`, [ids]);
      const have = new Set((r.rows as any[]).map((row) => String(row.id)));
      const missing = ids.filter((id) => !have.has(id));
      if (missing.length) {
        return makeRequestError(400, `Spell grant(s) reference unknown spellId: ${missing.join(", ")}. Create/seed them first.`);
      }
    }

    if (input.rewardAbilityGrants.length) {
      const ids = Array.from(new Set(input.rewardAbilityGrants.map((g) => g.abilityId)));
      const r = await db.query(`SELECT id FROM abilities WHERE id = ANY($1::text[])`, [ids]);
      const have = new Set((r.rows as any[]).map((row) => String(row.id)));
      const missing = ids.filter((id) => !have.has(id));
      if (missing.length) {
        return makeRequestError(400, `Ability grant(s) reference unknown abilityId: ${missing.join(", ")}. Create/seed them first.`);
      }
    }

    if (input.turninPolicy === "npc") {
      if (!input.turninNpcId) {
        return makeRequestError(400, "turninNpcId is required when turninPolicy is 'npc'.");
      }

      const npcCheck = await db.query("SELECT 1 FROM npcs WHERE id = $1", [input.turninNpcId]);
      if (npcCheck.rowCount === 0) {
        return makeRequestError(400, `Turn-in NPC '${input.turninNpcId}' does not exist. Create it first in the NPC editor.`);
      }
    }
  } catch (err) {
    console.warn("[ADMIN/QUESTS] validation skipped due to DB error", err);
  }

  return null;
}

export async function upsertAdminQuest(input: NormalizedAdminQuestUpsert, questService: PostgresQuestService): Promise<void> {
  const dbKind = input.objectiveKind === "collect_item" ? "item_turnin" : input.objectiveKind;

  await db.query(
    `
      INSERT INTO quests (id, name, description, repeatable, max_repeats, turnin_policy, turnin_npc_id, turnin_board_id, is_enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        repeatable = EXCLUDED.repeatable,
        max_repeats = EXCLUDED.max_repeats,
        turnin_policy = EXCLUDED.turnin_policy,
        turnin_npc_id = EXCLUDED.turnin_npc_id,
        turnin_board_id = EXCLUDED.turnin_board_id,
        updated_at = NOW()
      `,
    [input.id, input.name, input.description, input.repeatable, input.maxCompletions, input.turninPolicy, input.turninNpcId, input.turninBoardId]
  );

  await db.query("DELETE FROM quest_objectives WHERE quest_id = $1", [input.id]);
  await db.query("DELETE FROM quest_rewards WHERE quest_id = $1", [input.id]);

  await db.query(
    `
      INSERT INTO quest_objectives (quest_id, idx, kind, target_id, required, extra_json)
      VALUES ($1, 0, $2, $3, $4, '{}'::jsonb)
      `,
    [input.id, dbKind, input.objectiveTargetId, input.objectiveRequired]
  );

  if (input.rewardXp > 0) {
    await db.query(
      `
        INSERT INTO quest_rewards (quest_id, kind, amount, extra_json)
        VALUES ($1, 'xp', $2, '{}'::jsonb)
        `,
      [input.id, input.rewardXp]
    );
  }

  if (input.rewardGold > 0) {
    await db.query(
      `
        INSERT INTO quest_rewards (quest_id, kind, amount, extra_json)
        VALUES ($1, 'gold', $2, '{}'::jsonb)
        `,
      [input.id, input.rewardGold]
    );
  }

  for (const it of input.rewardItems) {
    const qty = Math.max(1, Number(it.count || 1));
    await db.query(
      `
        INSERT INTO quest_rewards (quest_id, kind, item_id, item_qty, extra_json)
        VALUES ($1, 'item', $2, $3, '{}'::jsonb)
        `,
      [input.id, it.itemId, qty]
    );
  }

  for (const g of input.rewardSpellGrants) {
    const source = (g.source || "").trim() || `quest:${input.id}`;
    await db.query(
      `
        INSERT INTO quest_rewards (quest_id, kind, extra_json)
        VALUES ($1, 'spell_grant', $2::jsonb)
        `,
      [input.id, JSON.stringify({ spellId: g.spellId, source })]
    );
  }

  for (const g of input.rewardAbilityGrants) {
    const source = (g.source || "").trim() || `quest:${input.id}`;
    await db.query(
      `
        INSERT INTO quest_rewards (quest_id, kind, extra_json)
        VALUES ($1, 'ability_grant', $2::jsonb)
        `,
      [input.id, JSON.stringify({ abilityId: g.abilityId, source })]
    );
  }

  const defs = await questService.listQuests();
  setQuestDefinitions(defs);
}
