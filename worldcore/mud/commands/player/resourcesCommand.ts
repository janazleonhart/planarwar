// worldcore/mud/commands/player/resourcesCommand.ts

import {
  ensurePowerResourceMap,
  getPrimaryPowerResourceForClass,
  getOrInitPowerResource,
  PowerResourceKind,
} from "../../../resources/PowerResources";

import { getPowerResourcesForClass } from "../../../classes/ClassDefinitions";

export async function handleResourcesCommand(
  _ctx: any,
  char: any,
  _input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const classId = (char.classId ?? "").toLowerCase();
  const lines: string[] = [];

  lines.push("Resources:");
  lines.push("");

  // Prefer class metadata if available (supports multi-resource classes cleanly)
  const classResources = getPowerResourcesForClass(classId);

  if (classResources.length > 0) {
    const map = ensurePowerResourceMap(char);

    for (const spec of classResources) {
      const kind = spec.id as PowerResourceKind;

      // Use existing pool if present, otherwise initialize
      const existing = map[kind];
      const pool = existing ?? getOrInitPowerResource(char, kind);

      const label =
        kind === "fury" ? "Fury" : kind === "mana" ? "Mana" : kind;

      lines.push(`- ${label}: ${pool.current}/${pool.max}`);
    }
  } else {
    // Fallback: original behavior (primary-only, with optional Adventurer secondary)
    const primary: PowerResourceKind = getPrimaryPowerResourceForClass(
      char.classId
    );
    const primaryPool = getOrInitPowerResource(char, primary);
    const primaryLabel = primary === "fury" ? "Fury" : "Mana";

    lines.push(`- ${primaryLabel}: ${primaryPool.current}/${primaryPool.max}`);

    // Old Adventurer hook kept for safety in fallback path
    const isAdventurer = classId === "adventurer";
    if (isAdventurer) {
      const map = ensurePowerResourceMap(char);
      const secondary: PowerResourceKind =
        primary === "fury" ? "mana" : "fury";
      const secPool = map[secondary];

      if (secPool) {
        const secLabel = secondary === "fury" ? "Fury" : "Mana";
        lines.push(`- ${secLabel}: ${secPool.current}/${secPool.max}`);
      }
    }
  }

  return lines.join("\n");
}
