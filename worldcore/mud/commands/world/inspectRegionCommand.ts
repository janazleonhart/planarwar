//worldcore/mud/commands/world/inspectRegionCommands.ts

export async function handleInspectRegionCommand(
    ctx: any,
    char: any,
    input: { cmd: string; args: string[]; parts: string[]; world?: any }
  ): Promise<string> {
    const world = input.world;
    if (!world) return "The world is unavailable.";
  
    const region = world.getRegionAt(char.posX, char.posZ);
    if (!region) return "You are nowhere.";
  
    return `Region ID: ${region.id}\nThis region is managed by the world engine.`;
  }
  