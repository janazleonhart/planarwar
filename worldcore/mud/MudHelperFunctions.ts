//worldcore/mud/MudHelperFunctions.ts

// NOTE: This file is being dismantled.
// Do not add new helpers here. Add them to the appropriate shared module instead.

export { describeLootLine } from "../loot/lootText";
export { rollInt } from "../utils/random";
export { grantTaskRewards } from "../progression/rewards/grantTaskRewards";
export {
  markInCombat,
  killEntity,
  isDeadEntity,
  resurrectEntity,
  applySimpleDamageToPlayer,
  computeNpcMeleeDamage,
} from "../combat/entityCombat";
export {
  findTargetPlayerEntityByName,
  findNearestNpcByName,
  findNpcTargetByName,
} from "../targeting/targetFinders";
export { ensureRegenLoop } from "../systems/regen/ensureRegenLoop";
export { formatRegionLabel, prettyRegionName } from "../world/regionText";







