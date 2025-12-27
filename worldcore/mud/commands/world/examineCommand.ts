// worldcore/mud/commands/world/examineCommand.ts

import { getNpcPrototype } from "../../../npc/NpcTypes";
import { findNpcTargetByName } from "../../../targeting/targetFinders";

export async function handleExamineCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const what = input.args.join(" ").trim();

  if (!what) return "Usage: examine <thing>";
  if (!ctx.entities) return "You can't see anything clearly here.";

  const roomId = ctx.session.roomId ?? char.shardId;

  // 1) Try NPCs / resource nodes first (rats, ore, etc.)
  const npcEnt = findNpcTargetByName(ctx, roomId, what);
  if (npcEnt && ctx.npcs) {
    const npcState = ctx.npcs.getNpcStateByEntityId(npcEnt.id);
    const proto = npcState ? getNpcPrototype(npcState.protoId) : undefined;

    const level = (npcState as any)?.level ?? proto?.level ?? 1;

    const currentHp =
      (npcState as any)?.hp ?? (npcEnt as any).hp ?? proto?.maxHp ?? 1;

    const maxHp = proto?.maxHp ?? (npcEnt as any).maxHp ?? currentHp;

    const lines: string[] = [];
    lines.push(`${npcEnt.name} (level ${level})`);
    lines.push(`HP: ${currentHp}/${maxHp}`);

    if (proto?.tags && proto.tags.length > 0) {
      lines.push(`Tags: ${proto.tags.join(", ")}`);
    }

    if (proto?.id === "ore_vein_small") {
      lines.push("It looks like a small hematite ore vein. You can harvest ore here.");
    } else if (proto?.id === "town_rat") {
      lines.push("A scruffy town rat. More nuisance than threat, but it still bites.");
    }

    // preserve your current behavior: join with spaces
    return lines.join(" ");
  }

  // 2) (Later we can add item / player / object examines here)
  return `You don't see '${what}' here to examine.`;
}
