// worldcore/actions/WorldActionService.ts

import { ActionRequest } from "./ActionTypes";
import { handleAttackAction, handleGatherAction } from "../mud/MudActions";

/**
 * Minimal shared context for world actions.
 *
 * v1 is intentionally vague; when we migrate logic out of MudCommandHandler,
 * we’ll tighten this up and replace `any` with real services.
 */
export interface WorldActionContext {
  // later:
  // world: ServerWorldManager;
  // npcs: NpcManager;
  // entities: EntityManager;
  // items: ItemService;
  // characters: CharacterService;
  // rooms?: RoomManager;
  // session?: Session;
  // etc.
  [key: string]: any;
}

/**
 * Standardized action result for any client (MUD, 2.5D, City Builder, etc.).
 *
 * v1: just an array of text messages. Later we can add:
 *  - combat log entries
 *  - changed targets
 *  - FX triggers, etc.
 */
export interface ActionResult {
  messages: string[];
}

/**
 * Shared entry point for world actions.
 *
 * v1: stubbed; we’ll gradually move the guts of `attack` / `harvest`
 * out of MudCommandHandler into specialized helpers that this calls.
 */
 export async function performAction(
    ctx: WorldActionContext,
    char: any,
    req: ActionRequest
  ): Promise<ActionResult> {
    switch (req.kind) {
      case "attack": {
        const target =
          req.targetName ??
          req.targetId ??
          ""; // if we only have an ID later, we can make this smarter
  
        if (!target) {
          return { messages: ["Usage: attack <targetName>"] };
        }
  
        const msg = await handleAttackAction(
          ctx as any, // WorldActionContext is intentionally loose
          char,
          target
        );
  
        return { messages: [msg] };
      }
  
      case "harvest": {
        const targetName =
          req.targetName ??
          req.targetId ??
          req.resourceType ??
          "";
  
        if (!targetName) {
          return { messages: ["Usage: harvest <thing>"] };
        }
  
        const msg = await handleGatherAction(
          ctx as any,
          char,
          targetName,
          req.resourceType
        );
  
        return { messages: [msg] };
      }
    }
  
    const _exhaustive: never = req;
    return { messages: ["Nothing happens."] };
  }