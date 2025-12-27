// worldcore/mud/commands/world/lookCommand.ts

export async function handleLookCommand(
    ctx: any,
    char: any,
    input: { cmd: string; args: string[]; parts: string[] },
    world: any
  ): Promise<string> {
    if (!world) return "The world is unavailable.";
  
    const region = world.getRegionAt(char.posX, char.posZ);
    if (!region) return "You are nowhere.";
  
    const roomId = ctx.session.roomId ?? char.shardId;
  
    // Region label – be defensive about what fields exist
    const regionLabel = (region as any).name ?? (region as any).kind ?? region.id;
  
    // Base line
    let out = `You are in ${regionLabel}.\n`;
  
    // --- NPCs in this room (real entities with type "npc") ---
    if (ctx.entities) {
      const all = ctx.entities.getAll(); // Entity[]
      const npcs = all.filter(
        (e: any) => e.type === "npc" && e.roomId === roomId && e.alive !== false
      );
  
      if (npcs.length) {
        out += `\nNPCs nearby:\n`;
        for (const npc of npcs) {
          const hp = npc.hp ?? "?";
          const maxHp = npc.maxHp ?? "?";
          out += ` - ${npc.name} (${hp}/${maxHp} HP)\n`;
        }
      }
    }
  
    return out;
  }
  