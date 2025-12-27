// worldcore/terrain/regions/RegionDisplay.ts

import type { Region } from "./RegionTypes";
import { generateRegionName } from "./RegionNaming";
import type { Faction } from "../../factions/FactionTypes";

export function getRegionDisplayName(
  region: Region,
  controllingFaction?: Faction | null
): string {
  const base = generateRegionName(region);

  if (!controllingFaction) return base;

  const nick = controllingFaction.nickname || controllingFaction.name;
  if (!nick) return base;

  // Later we can vary this string per faction type or culture.
  return `${base} — Domain of ${nick}`;
}
