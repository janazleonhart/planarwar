// worldcore/sim/BrainActions.ts
// Brain actions: the "planner" returns actions; the harness can apply them.

import type { SimSpawnPoint, SimWorld } from "./SimWorld";

export type PlaceSpawnAction = {
  kind: "place_spawn";
  spawn: SimSpawnPoint;
};

export type BrainAction = PlaceSpawnAction;

export function applyActions(world: SimWorld, actions: readonly BrainAction[]): void {
  for (const a of actions) {
    switch (a.kind) {
      case "place_spawn":
        world.upsertSpawn(a.spawn);
        break;

      default: {
        const kind = (a as any)?.kind;
        throw new Error(`Unknown BrainAction: ${String(kind)}`);
      }
    }
  }
}
