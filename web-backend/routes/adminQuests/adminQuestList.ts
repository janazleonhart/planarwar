// web-backend/routes/adminQuests/adminQuestList.ts

import { db } from "../../../worldcore/db/Database";
import { PostgresQuestService } from "../../../worldcore/quests/PostgresQuestService";

import type {
  AdminQuestPayload,
  AdminRewardAbilityGrant,
  AdminRewardItem,
  AdminRewardSpellGrant,
  ObjectiveKind,
} from "./adminQuestTypes";

function mapQuestDefinitionToPayload(q: any): AdminQuestPayload {
  const firstObj = q.objectives[0];
  const rawKind = (firstObj?.kind as any) ?? "kill";
  const objectiveKind: ObjectiveKind = rawKind === "item_turnin" ? "collect_item" : (rawKind as ObjectiveKind);

  const targetId =
    (firstObj as any)?.targetProtoId ??
    (firstObj as any)?.nodeProtoId ??
    (firstObj as any)?.itemId ??
    (firstObj as any)?.actionId ??
    (firstObj as any)?.cityActionId ??
    (firstObj as any)?.npcId ??
    "";

  const required = (firstObj as any)?.required ?? 1;
  const reward = q.reward || {};

  const rewardItems: AdminRewardItem[] = Array.isArray((reward as any).items)
    ? ((reward as any).items as any[]).map((it) => ({
        itemId: String(it?.itemId ?? ""),
        count: Number(it?.count ?? 1),
      }))
    : [];

  const rewardSpellGrants: AdminRewardSpellGrant[] = Array.isArray((reward as any).spellGrants)
    ? ((reward as any).spellGrants as any[]).map((g) => ({
        spellId: String(g?.spellId ?? ""),
        source: g?.source ? String(g.source) : undefined,
      }))
    : [];

  const rewardAbilityGrants: AdminRewardAbilityGrant[] = Array.isArray((reward as any).abilityGrants)
    ? ((reward as any).abilityGrants as any[]).map((g) => ({
        abilityId: String(g?.abilityId ?? ""),
        source: g?.source ? String(g.source) : undefined,
      }))
    : [];

  return {
    id: q.id,
    name: q.name,
    description: q.description,
    repeatable: !!q.repeatable,
    maxCompletions: q.maxCompletions ?? null,
    turninPolicy: ((q as any).turninPolicy as any) ?? "anywhere",
    turninNpcId: ((q as any).turninNpcId as any) ?? null,
    turninBoardId: ((q as any).turninBoardId as any) ?? null,
    objectiveKind,
    objectiveTargetId: targetId,
    objectiveRequired: required,
    rewardXp: (reward as any).xp ?? 0,
    rewardGold: (reward as any).gold ?? 0,
    rewardItems,
    rewardSpellGrants,
    rewardAbilityGrants,
  };
}

async function hydrateItemLabels(payload: AdminQuestPayload[]): Promise<void> {
  const objectiveItemIds = payload
    .filter((q) => q.objectiveKind === "collect_item" && !!q.objectiveTargetId)
    .map((q) => q.objectiveTargetId);

  const rewardItemIds = payload
    .flatMap((q) => q.rewardItems ?? [])
    .map((it) => it.itemId)
    .filter(Boolean);

  const itemIds = Array.from(new Set([...objectiveItemIds, ...rewardItemIds].map((x) => String(x)).filter(Boolean)));
  if (!itemIds.length) return;

  try {
    const r = await db.query(`SELECT id, name, rarity FROM items WHERE id = ANY($1::text[])`, [itemIds]);
    const map = new Map<string, { name: string; rarity: string }>();
    for (const row of r.rows as any[]) {
      map.set(String(row.id), {
        name: String(row.name ?? ""),
        rarity: String(row.rarity ?? ""),
      });
    }

    for (const q of payload) {
      if (q.objectiveKind === "collect_item") {
        const hit = map.get(q.objectiveTargetId);
        if (hit) {
          q.objectiveTargetName = hit.name;
          q.objectiveTargetRarity = hit.rarity;
        }
      }

      for (const it of q.rewardItems ?? []) {
        const hit = map.get(it.itemId);
        if (hit) {
          it.itemName = hit.name;
          it.itemRarity = hit.rarity;
        }
      }
    }
  } catch (err) {
    console.warn("[ADMIN/QUESTS] item label lookup skipped due to DB error", err);
  }
}

async function hydrateSpellLabels(payload: AdminQuestPayload[]): Promise<void> {
  const spellIds = Array.from(
    new Set(
      payload
        .flatMap((q) => q.rewardSpellGrants ?? [])
        .map((g) => (g.spellId || "").trim())
        .filter(Boolean)
    )
  );
  if (!spellIds.length) return;

  try {
    const r = await db.query(`SELECT id, name FROM spells WHERE id = ANY($1::text[])`, [spellIds]);
    const map = new Map<string, string>();
    for (const row of r.rows as any[]) {
      map.set(String(row.id), String(row.name ?? ""));
    }
    for (const q of payload) {
      for (const g of q.rewardSpellGrants ?? []) {
        const hit = map.get((g.spellId || "").trim());
        if (hit) g.spellName = hit;
      }
    }
  } catch (err) {
    console.warn("[ADMIN/QUESTS] spell label lookup skipped due to DB error", err);
  }
}

async function hydrateAbilityLabels(payload: AdminQuestPayload[]): Promise<void> {
  const abilityIds = Array.from(
    new Set(
      payload
        .flatMap((q) => q.rewardAbilityGrants ?? [])
        .map((g) => (g.abilityId || "").trim())
        .filter(Boolean)
    )
  );
  if (!abilityIds.length) return;

  try {
    const r = await db.query(`SELECT id, name FROM abilities WHERE id = ANY($1::text[])`, [abilityIds]);
    const map = new Map<string, string>();
    for (const row of r.rows as any[]) {
      map.set(String(row.id), String(row.name ?? ""));
    }
    for (const q of payload) {
      for (const g of q.rewardAbilityGrants ?? []) {
        const hit = map.get((g.abilityId || "").trim());
        if (hit) g.abilityName = hit;
      }
    }
  } catch (err) {
    console.warn("[ADMIN/QUESTS] ability label lookup skipped due to DB error", err);
  }
}

export async function listAdminQuests(questService: PostgresQuestService): Promise<AdminQuestPayload[]> {
  const defs = await questService.listQuests();
  const payload = defs.map(mapQuestDefinitionToPayload);
  await hydrateItemLabels(payload);
  await hydrateSpellLabels(payload);
  await hydrateAbilityLabels(payload);
  return payload;
}
