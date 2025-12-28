//worldcore/world/NavGridManager.ts

/**
 * Stub nav-grid holder for shard movement/pathing. Keeps a reference to the
 * ServerWorldManager so future navmesh generation can pull height/region data.
 */

import { Logger } from "../utils/logger";
import type { ServerWorldManager } from "./ServerWorldManager";

export class NavGridManager {
  private log = Logger.scope("NAVGRID");

  constructor(private world: ServerWorldManager) {}

  // Called by future movement systems to ensure nav data is ready.
  async init(): Promise<void> {
    this.log.info("NavGridManager init (stub)");
  }
}
