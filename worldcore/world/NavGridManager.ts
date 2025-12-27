//worldcore/world/NavGridManager.ts

import { Logger } from "../utils/logger";

/**
 * Phase 1 stub NavGridManager.
 *
 * Pathfinding / navmesh integration will be added in a later pass;
 * for now this just keeps the type system happy and gives us a hook
 * to expand later.
 */
export class NavGridManager {
  private log = Logger.scope("NAVGRID");

  constructor(private world: any) {
    // 'world' is intentionally typed as 'any' for now to avoid
    // premature coupling to ServerWorldManager internals.
  }

  // Called by future movement systems to ensure nav data is ready.
  async init(): Promise<void> {
    this.log.info("NavGridManager init (stub)");
  }
}
