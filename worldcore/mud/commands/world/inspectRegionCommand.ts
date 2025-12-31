// worldcore/mud/commands/world/inspectRegionCommand.ts

/**
 * Admin/debug helper:
 *   inspect_region
 *
 * Shows which terrain region the character is standing in plus some
 * lightweight MMO-friendly metadata. This is intentionally read-only
 * and safe to expose to trusted staff.
 */
export async function handleInspectRegionCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any },
): Promise<string> {
  const world = input.world;
  if (!world) {
    return "The world is unavailable.";
  }

  const region = world.getRegionAt?.(char.posX, char.posZ);
  if (!region) {
    return "You are nowhere. (No terrain region claims this tile.)";
  }

  const id = region.id ?? "unknown";
  const name = region.name ?? "Unnamed region";
  const tier = region.tier ?? region.level ?? "?";
  const shardId =
    (world && (world.id || world.worldId || world.shardId)) ?? "unknown";

  const tags: string[] = Array.isArray(region.tags) ? region.tags : [];
  const tagsText = tags.length ? tags.join(", ") : "none";

  const notes: string[] = [];
  if (tags.includes("town")) notes.push("town");
  if (tags.includes("safe_hub")) notes.push("safe hub");
  if (tags.includes("graveyard")) notes.push("graveyard");

  const notesText =
    notes.length > 0 ? notes.join(", ") : "no special semantic tags";

  const pos = `(${char.posX}, ${char.posZ})`;

  return [
    `Region: ${name} [${id}]`,
    `Shard: ${shardId}`,
    `Tier: ${tier}`,
    `Position: ${pos}`,
    `Tags: ${tagsText}`,
    `Notes: ${notesText}`,
  ].join("\n");
}
