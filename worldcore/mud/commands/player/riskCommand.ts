// worldcore/mud/commands/player/riskCommand.ts
//
// Show cowardice + region danger status in a compact way.
//
// Usage:
//   > risk
//   > cowardice   (alias)
//
// Output example:
//   [risk:on] cowardice: 2/5 stacks (tier 3 mid, +22.5% dmg taken, ~11s left)
//   [risk] Region danger: tier 3 mid (3+ applies Region Peril aura)

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import type { MudCommandInput } from "../types";

import {
  getCowardiceInfo,
  formatCowardiceStatus,
} from "../../../combat/Cowardice";
import { getRegionDangerForCharacter } from "../../../world/RegionDanger";

export async function handleRiskCommand(
  _ctx: MudContext,
  char: CharacterState,
  _input: MudCommandInput,
): Promise<string> {
  const now = Date.now();

  const cow = getCowardiceInfo(char, now);
  const cowardiceLine = formatCowardiceStatus(cow);

  const tier = getRegionDangerForCharacter(char, now);

  const tierLabel = (() => {
    switch (tier) {
      case 1:
        return "safe";
      case 2:
        return "low";
      case 3:
        return "mid";
      case 4:
        return "high";
      case 5:
        return "lethal";
      default:
        return "unknown";
    }
  })();

  const lines: string[] = [];

  // Cowardice + stacks + % dmg taken
  lines.push(cowardiceLine);

  // Region danger + a hint about the aura threshold
  lines.push(
    `[risk] Region danger: tier ${tier} ${tierLabel} (3+ applies Region Peril aura, +5% incoming damage).`,
  );

  return lines.join("\n");
}
