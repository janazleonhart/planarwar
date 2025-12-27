//worldcore/mud/commands/world/talkCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import { findNpcTargetByName } from "../../../targeting/targetFinders";
import { getNpcPrototype } from "../../../npc/NpcTypes";
import { applyProgressionEvent } from "../../../progression/ProgressionCore";
import { applyProgressionForEvent } from "../../MudProgressionHooks";

export async function handleTalkCommand(
  ctx: MudContext,
  char: CharacterState,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const targetNameRaw = input.args.join(" ").trim();
  if (!targetNameRaw) return "Usage: talk <who>";

  const selfEntity = ctx.entities?.getEntityByOwner(ctx.session.id);
  if (!selfEntity) return "You don't have a world entity yet.";

  const roomId = selfEntity.roomId ?? char.shardId;
  // targetFinders expects an entity provider, not the full MudContext
  if (!ctx.entities) return "World entities are not available.";
  const target = findNpcTargetByName(ctx.entities, roomId, targetNameRaw);
  if (!target) return `There is no '${targetNameRaw}' here to talk to.`;

  const npcState = ctx.npcs?.getNpcStateByEntityId(target.id);
  if (!npcState) return "You can't talk to that.";

  const proto = getNpcPrototype(npcState.protoId);
  if (!proto) return "You can't talk to that.";

  // 1) progression event
  applyProgressionEvent(char, {
    kind: "talk_to",
    npcId: proto.id,
  });

  // 2) tasks/quests/titles + DB patch
  const { snippets } = await applyProgressionForEvent(ctx, char, "kills", proto.id);
  // ^ category is a bit arbitrary here; all that matters is the hook runs.

  let line = `[talk] You speak with ${proto.name}.`;
  if (snippets.length > 0) {
    line += " " + snippets.join(" ");
  }

  return line;
}
