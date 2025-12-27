// worldcore/mud/commands/player/resourcesCommand.ts

import {
  ensurePowerResourceMap,
  getPrimaryPowerResourceForClass,
  getOrInitPowerResource,
  PowerResourceKind,
} from "../../../resources/PowerResources";

export async function handleResourcesCommand(
  ctx: any,
  char: any,
  _input: { cmd: string; args: string[]; parts: string[] }
): Promise<string> {
  const classId = (char.classId ?? "").toLowerCase();

  // Work out the primary pool for this class and ensure it exists
  const primary: PowerResourceKind = getPrimaryPowerResourceForClass(char.classId);
  const primaryPool = getOrInitPowerResource(char, primary);

  const lines: string[] = [];
  lines.push("Resources:");
  lines.push("");

  const primaryLabel = primary === "fury" ? "Fury" : "Mana";
  lines.push(`- ${primaryLabel}: ${primaryPool.current}/${primaryPool.max}`);

  // 🔮 Adventurer hook:
  // When we do the full chaos pass, we can let them show a secondary pool.
  // For now this is OFF; they behave like a single-resource class.
  const isAdventurer = classId === "adventurer";
  if (isAdventurer) {
    const map = ensurePowerResourceMap(char);
    const secondary: PowerResourceKind = primary === "fury" ? "mana" : "fury";
    const secPool = map[secondary];
    if (secPool) {
      const secLabel = secondary === "fury" ? "Fury" : "Mana";
      lines.push(`- ${secLabel}: ${secPool.current}/${secPool.max}`);
    }
  }

  return lines.join("\n");
}
