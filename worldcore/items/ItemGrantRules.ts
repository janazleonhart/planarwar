// worldcore/items/ItemGrantRules.ts

import { StaffRole, StaffRoleLevel } from "../auth/StaffRoles";
import { ShardConfig } from "../config/ShardConfig";
import { ItemDefinition } from "./ItemTypes";

export type ShardMode = "dev" | "live";

export interface ItemGrantContext {
  actorRole: StaffRole;
  shardMode: ShardMode;
}

export function canGrantItemToPlayer(
  ctx: ItemGrantContext,
  item: ItemDefinition
): boolean {
  const { actorRole, shardMode } = ctx;

  // Owner: god mode.
  if (actorRole === "owner") return true;

  const actorLevel = StaffRoleLevel[actorRole];
  const requiredLevel = StaffRoleLevel[item.grantMinRole];

  // Too low rank for this item? Hard no.
  if (actorLevel < requiredLevel) {
    return false;
  }

  // Dev-only item on LIVE shard:
  if (shardMode === "live" && item.isDevOnly) {
    // Only dev (and owner, already handled) can touch it.
    return actorRole === "dev";
  }

  return true;
}