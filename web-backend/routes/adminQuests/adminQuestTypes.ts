// web-backend/routes/adminQuests/adminQuestTypes.ts

export type ObjectiveKind = "kill" | "harvest" | "collect_item" | "craft" | "talk_to" | "city";

export type AdminRewardItem = {
  itemId: string;
  count: number;
  itemName?: string;
  itemRarity?: string;
};

export type AdminRewardSpellGrant = {
  spellId: string;
  source?: string;
  spellName?: string;
};

export type AdminRewardAbilityGrant = {
  abilityId: string;
  source?: string;
  abilityName?: string;
};

export type AdminQuestPayload = {
  id: string;
  name: string;
  description: string;
  repeatable?: boolean;
  maxCompletions?: number | null;
  turninPolicy?: "anywhere" | "board" | "npc";
  turninNpcId?: string | null;
  turninBoardId?: string | null;
  objectiveKind: ObjectiveKind;
  objectiveTargetId: string;
  objectiveRequired: number;
  objectiveTargetName?: string;
  objectiveTargetRarity?: string;
  rewardXp?: number;
  rewardGold?: number;
  rewardItems?: AdminRewardItem[];
  rewardSpellGrants?: AdminRewardSpellGrant[];
  rewardAbilityGrants?: AdminRewardAbilityGrant[];
};

export type NormalizedAdminQuestUpsert = {
  id: string;
  name: string;
  description: string;
  repeatable: boolean;
  maxCompletions: number | null;
  turninPolicy: "anywhere" | "board" | "npc";
  turninNpcId: string | null;
  turninBoardId: string | null;
  objectiveKind: ObjectiveKind;
  objectiveTargetId: string;
  objectiveRequired: number;
  rewardXp: number;
  rewardGold: number;
  rewardItems: { itemId: string; count: number }[];
  rewardSpellGrants: { spellId: string; source?: string }[];
  rewardAbilityGrants: { abilityId: string; source?: string }[];
};
