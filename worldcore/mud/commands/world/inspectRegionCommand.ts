//worldcore/mud/commands/world/inspectRegionCommands.ts

export async function handleInspectRegionCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const world = input.world;
  if (!world) {
    return "The world is unavailable.";
  }

  const x = typeof char.posX === "number" ? char.posX : 0;
  const z = typeof char.posZ === "number" ? char.posZ : 0;

  const region = world.getRegionAt ? world.getRegionAt(x, z) : null;
  if (!region) {
    return `You are in an unmapped area at (${x.toFixed(2)}, ${z.toFixed(2)}).`;
  }

  const id = region.id ?? "unknown";
  const name = region.name ?? "Unnamed region";
  const tier = region.tier ?? region.level ?? "?";

  // Best-effort extraction of tags/flags; everything is 'any' here on purpose
  const tags: string[] = Array.isArray(region.tags) ? region.tags : [];

  const flags = (region.flags ?? {}) as {
    isTown?: boolean;
    isSafeHub?: boolean;
    isGraveyard?: boolean;
    isLawless?: boolean;
  };

  const isTown =
    flags.isTown || tags.includes("town") || tags.includes("city");
  const isSafeHub =
    flags.isSafeHub || tags.includes("safe_hub") || tags.includes("sanctuary");
  const isGraveyard =
    flags.isGraveyard || tags.includes("graveyard") || tags.includes("gy");
  const isLawless = flags.isLawless || tags.includes("lawless");

  const semantic: string[] = [];
  if (isTown) semantic.push("town");
  if (isSafeHub) semantic.push("safe hub");
  if (isGraveyard) semantic.push("graveyard");
  if (isLawless) semantic.push("lawless");

  const tagsText = tags.length ? tags.join(", ") : "none";
  const semanticText = semantic.length ? semantic.join(", ") : "none";

  const posLine = `World position: (${x.toFixed(2)}, ${z.toFixed(2)})`;

  return [
    `Region: ${name} [${id}]`,
    `Tier: ${tier}`,
    posLine,
    `Tags: ${tagsText}`,
    `Semantic: ${semanticText}`,
  ].join("\n");
}
