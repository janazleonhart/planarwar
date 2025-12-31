// worldcore/actions/WorldActionService.ts

import type { ActionRequest } from "./ActionTypes";
import { handleAttackAction, handleGatherAction } from "../mud/MudActions";
import type { MudContext } from "../mud/MudContext";
import type { CharacterState } from "../characters/CharacterTypes";
import type { GatheringKind } from "../progression/ProgressEvents";

/**
 * Minimal shared context for world actions.
 *
 * v1 keeps this intentionally loose; when we migrate more logic out of
 * MudCommandHandler we can tighten this into a proper service bag.
 */
export interface WorldActionContext {
  // Later: explicit services instead of index signature.
  [key: string]: unknown;
}

/**
 * Standardized action result for any client (MUD, 2.5D, City Builder, etc.).
 *
 * v1: just an array of text messages. Later, we can extend this to include
 * combat logs, FX triggers, changed targets, etc.
 */
export interface ActionResult {
  messages: string[];
}

/**
 * Map the HarvestActionRequest.resourceType hint into the generic
 * GatheringKind + resource tag used by Progression + NPC tags.
 */
function resolveGatheringKindAndTag(
  resourceType?: "ore" | "herb" | "wood" | "fish",
): { kind: GatheringKind; tag: string } {
  switch (resourceType) {
    case "herb":
      return { kind: "herbalism", tag: "resource_herb" };
    case "wood":
      return { kind: "logging", tag: "resource_wood" };
    case "fish":
      return { kind: "fishing", tag: "resource_fish" };
    case "ore":
    default:
      return { kind: "mining", tag: "resource_ore" };
  }
}

/**
 * Shared entry point for world actions.
 *
 * v1: Only "attack" and "harvest" are routed here; more kinds can be added
 * as we migrate logic out of MudCommandHandler.
 */
export async function performAction(
  ctx: WorldActionContext & MudContext,
  char: CharacterState,
  req: ActionRequest,
): Promise<ActionResult> {
  switch (req.kind) {
    case "attack": {
      // v1 behavior: prefer targetName, fall back to targetId if present.
      const target = req.targetName ?? req.targetId ?? "";
      if (!target) {
        return { messages: ["Usage: attack <target>"] };
      }

      const msg = await handleAttackAction(
        ctx as unknown as MudContext,
        char,
        target,
      );
      return { messages: [msg] };
    }

    case "harvest": {
      const targetName = req.targetName ?? req.targetId ?? "";
      if (!targetName) {
        return { messages: ["Usage: harvest <target>"] };
      }

      const { kind, tag } = resolveGatheringKindAndTag(req.resourceType);
      const msg = await handleGatherAction(
        ctx as unknown as MudContext,
        char,
        targetName,
        kind,
        tag,
      );
      return { messages: [msg] };
    }

    default: {
      // Exhaustiveness guard – if we add a new kind and forget to handle it
      // TypeScript will complain here.
      const _never: never = req;
      void _never;
      return { messages: ["Nothing happens."] };
    }
  }
}
