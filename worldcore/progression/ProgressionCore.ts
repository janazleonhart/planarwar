// worldcore/progression/ProgressionCore.ts

import type { CharacterState, ProgressionState } from "../characters/CharacterTypes";
import type { GatheringKind } from "../progression/ProgressEvents";

export type ProgressionCategory = "kills" | "harvests";

export type ProgressionEventKind =
  | "kill"
  | "harvest"
  | "collect_item"
  | "use_item"
  | "action"
  | "city"
  | "talk_to"
  | "enter_region"
  | "flag";

export interface ProgressionEventKill {
  kind: "kill";
  targetProtoId: string;
}

export interface ProgressionEventHarvest {
  kind: "harvest";
  nodeProtoId: string;

  gatheringKind?: GatheringKind;
  amount?: number;

  // NEW (C): identify the DB spawn_points row so depletion can be per-character
  spawnPointId?: number;

  // NEW (C): if set, harvesting depletes this node for the character
  respawnSeconds?: number;
}

export interface ProgressionEventAction {
  kind: "action";
  actionId: string;
}

export interface ProgressionEventCity {
  kind: "city";
  cityActionId: string;
}

export interface ProgressionEventCollectItem {
  kind: "collect_item";
  itemId: string;
  count?: number;
}

export interface ProgressionEventUseItem {
  kind: "use_item";
  itemId: string;
  count?: number;
}

export interface ProgressionEventTalkTo {
  kind: "talk_to";
  npcId: string;
}

export interface ProgressionEventEnterRegion {
  kind: "enter_region";
  regionId: string;
}

export interface ProgressionEventFlag {
  kind: "flag";
  flagName: string;
  flagValue?: boolean | number | string;
}

export type ProgressionEvent =
  | ProgressionEventKill
  | ProgressionEventHarvest
  | ProgressionEventAction
  | ProgressionEventCity
  | ProgressionEventCollectItem
  | ProgressionEventUseItem
  | ProgressionEventTalkTo
  | ProgressionEventEnterRegion
  | ProgressionEventFlag;

export function ensureProgression(char: CharacterState): ProgressionState {
  let prog = char.progression as ProgressionState | undefined;

  if (!prog || typeof prog !== "object") {
    prog = {};
    char.progression = prog as ProgressionState;
  }

  prog.kills ??= {};
  prog.harvests ??= {};
  prog.actions ??= {};
  prog.tasks ??= [];
  prog.quests ??= {};
  prog.titles ??= { unlocked: [], active: null };

  prog.collects ??= {};
  prog.flags ??= {};
  prog.exploration ??= {};
  prog.gathering ??= {};

  return prog;
}

export function incrementProgressionCounter(
  char: CharacterState,
  category: ProgressionCategory,
  key: string,
  amount: number = 1
): void {
  const prog = ensureProgression(char);

  if (category === "kills") {
    const kills = (prog.kills ||= {});
    kills[key] = (kills[key] ?? 0) + amount;
  } else if (category === "harvests") {
    const harvests = (prog.harvests ||= {});
    harvests[key] = (harvests[key] ?? 0) + amount;
  }
}

export function recordActionProgress(
  char: CharacterState,
  key: string,
  amount: number = 1
): void {
  const prog = ensureProgression(char);
  const actions = (prog.actions ||= {});
  actions[key] = (actions[key] ?? 0) + amount;
}

function bumpCounter(map: Record<string, number>, key: string, amt = 1) {
  map[key] = (map[key] ?? 0) + amt;
}

export function applyProgressionEvent(char: CharacterState, ev: ProgressionEvent): void {
  const prog = ensureProgression(char);

  switch (ev.kind) {
    case "kill": {
      incrementProgressionCounter(char, "kills", ev.targetProtoId, 1);
      break;
    }

    case "harvest": {
      const amount = ev.amount ?? 1;
      incrementProgressionCounter(char, "harvests", ev.nodeProtoId, amount);

      if (ev.gatheringKind) {
        const gMap = (prog.gathering ??= {});
        const stats = gMap[ev.gatheringKind] ?? { nodesGathered: 0 };
        stats.nodesGathered += amount;
        gMap[ev.gatheringKind] = stats;
      }

      // Personal depletion hook (C)
      if (typeof ev.spawnPointId === "number" && ev.spawnPointId > 0) {
        const respawn = ev.respawnSeconds ?? 0;
        if (respawn > 0) {
          setNodeDepletedUntil(char, ev.spawnPointId, Date.now() + respawn * 1000);
        }
      }
      break;
    }

    case "action": {
      recordActionProgress(char, ev.actionId, 1);
      break;
    }

    case "city": {
      recordActionProgress(char, ev.cityActionId, 1);
      break;
    }

    case "collect_item": {
      const cnt = ev.count ?? 1;
      const collects = (prog.collects ??= {});
      bumpCounter(collects, ev.itemId, cnt);
      break;
    }

    case "use_item": {
      const cnt = ev.count ?? 1;
      const flags = (prog.flags ??= {});
      flags[`used_item:${ev.itemId}`] = (Number(flags[`used_item:${ev.itemId}`]) || 0) + cnt;
      break;
    }

    case "talk_to": {
      const flags = (prog.flags ??= {});
      flags[`talked_to:${ev.npcId}`] = true;
      break;
    }

    case "enter_region": {
      const exploration = (prog.exploration ??= {});
      bumpCounter(exploration, ev.regionId, 1);
      break;
    }

    case "flag": {
      const flags = (prog.flags ??= {});
      flags[ev.flagName] = ev.flagValue ?? true;
      break;
    }
  }
}

// -----------------------------
// Personal node depletion helpers (C)
// -----------------------------
const NODE_DEPLETED_PREFIX = "node_depleted_until:";

export function getNodeDepletedUntil(char: CharacterState, spawnPointId: number): number {
  const prog = ensureProgression(char);
  const flags = (prog.flags ??= {});
  const v = flags[`${NODE_DEPLETED_PREFIX}${spawnPointId}`];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function isNodeAvailable(
  char: CharacterState,
  spawnPointId: number,
  nowMs: number = Date.now()
): boolean {
  return getNodeDepletedUntil(char, spawnPointId) <= nowMs;
}

export function setNodeDepletedUntil(
  char: CharacterState,
  spawnPointId: number,
  untilMs: number
): void {
  const prog = ensureProgression(char);
  const flags = (prog.flags ??= {});
  flags[`${NODE_DEPLETED_PREFIX}${spawnPointId}`] = untilMs;
}
