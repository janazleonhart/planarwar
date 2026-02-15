// worldcore/quests/QuestText.ts
//
// IMPORTANT CHANGE (Quest Board v0):
// - Quest log now renders ONLY accepted quests (present in QuestStateMap).
// - No more "missing entry means active" behavior.

import { ensureProgression } from "../progression/ProgressionCore";
import { ensureQuestState } from "./QuestState";
import { countItemInInventory } from "../items/inventoryConsume";
import { getQuestContextRoomId, resolveQuestDefinitionFromStateId } from "./TownQuestBoard";
import { getAllQuests, getQuestById } from "./QuestRegistry";
import { renderQuestAmbiguous } from "./QuestCommandText";

import type { QuestDefinition, QuestObjective } from "./QuestTypes";
import type { CharacterState } from "../characters/CharacterTypes";

export type QuestLogFilter = "all" | "ready" | "ready_here";

export type RenderQuestLogOpts = {
  filter?: QuestLogFilter;
  /** Optional MudContext-like object used to compute turn-in hints for READY quests. */
  ctx?: any;
};

export function renderQuestLog(char: CharacterState, opts: RenderQuestLogOpts = {}): string {
  const filter: QuestLogFilter = opts.filter ?? "all";
  const ctx = opts.ctx;

  const prog = ensureProgression(char);
  const kills = (prog.kills as Record<string, number>) || {};
  const harvests = (prog.harvests as Record<string, number>) || {};
  const actions = (prog.actions as Record<string, number>) || {};
  const flags = (prog.flags as Record<string, unknown>) || {};

  const state = ensureQuestState(char);
  const ids = Object.keys(state);

  if (ids.length === 0) {
    return "Quests:\n - None accepted.\n\nUse: quest board\n      quest accept <#|id>";
  }

  type Row = {
    id: string;
    name: string;
    mark: string;
    repeatInfo: string;
    isReady: boolean;
    sortKey: number;
    line: string;
    detailLines: string[];
  };

  const rows: Row[] = [];

  for (const id of ids) {
    const entry = state[id];
    if (!entry) continue;

    const q = resolveQuestDefinitionFromStateId(id, entry);

    const name = q?.name ?? id;
    const isCompleted = entry.state === "completed";
    const isTurnedIn = entry.state === "turned_in";

    const isReady = !!(
      q &&
      isCompleted &&
      areObjectivesSatisfied(q, char, { kills, harvests, actions, flags })
    );

    const turninHint = (q && isReady)
      ? computeTurninHint(ctx, char as any, q as any, entry)
      : null;

    if (filter === "ready" && !isReady) continue;
    if (filter === "ready_here") {
      if (!isReady) continue;
      // "ready_here" means "ready AND can be turned in from the current context".
      // We reuse the hinting logic: if a hint exists, it's not turn-in-able here.
      if (turninHint) continue;
    }

    const eligibleHere = !!(isReady && ctx && !turninHint);
    const mark = isTurnedIn
      ? "[T]"
      : isReady
        ? (eligibleHere ? "[READY][HERE]" : "[READY]")
        : isCompleted
          ? "[C]"
          : "[A]";

    // Sort: Active -> READY -> Completed -> Turned in
    const sortKey = isTurnedIn ? 3 : isReady ? 1 : isCompleted ? 2 : 0;

    let repeatInfo = "";
    if (q?.repeatable) {
      const completions = entry.completions ?? 0;
      const max = q.maxCompletions ?? null;

      if (max != null) repeatInfo = ` [repeatable ${completions}/${max}]`;
      else repeatInfo = ` [repeatable ${completions}/∞]`;
    }

    const detailLines: string[] = [];

    if (q) {
      if (isReady) {
        if (ctx) {
          detailLines.push(`   Eligible to turn in here: ${turninHint ? "NO" : "YES"}`);
        }
        const rewardText = renderQuestRewardSummary(q);
        if (rewardText) detailLines.push(`   Rewards: ${rewardText}`);

        if (turninHint) {
          detailLines.push(`   Turn-in: ${turninHint}`);
        }
      }

      for (const obj of q.objectives) {
        detailLines.push(renderObjectiveLine(char, obj, { kills, harvests, actions, flags }).trimEnd());
      }
    } else {
      detailLines.push("   - (Quest definition missing; cannot render objectives.)");
    }

    const line = ` ${mark} ${name} (${id})${repeatInfo}`;

    rows.push({
      id,
      name,
      mark,
      repeatInfo,
      isReady,
      sortKey,
      line,
      detailLines,
    });
  }

  if (rows.length === 0 && (filter === "ready" || filter === "ready_here")) {
    if (filter === "ready_here") {
      return "Quests (ready here):\n - None ready to turn in here.";
    }
    return "Quests (ready):\n - None ready to turn in.";
  }

  rows.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    // Stable-ish secondary ordering: name then id
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return a.id.localeCompare(b.id);
  });

  let out =
    filter === "ready" ? "Quests (ready):\n" :
    filter === "ready_here" ? "Quests (ready here):\n" :
    "Quests:\n";

  for (const r of rows) {
    out += `${r.line}\n`;
    for (const dl of r.detailLines) {
      out += `${dl}\n`;
    }
  }

  return out.trimEnd();
}

/**
 * Quest details view used by `quest show <#|id|name>`.
 * - Works for accepted quests (including deterministic town quests)
 * - Also works for registry quests not yet accepted
 */
export function renderQuestDetails(char: CharacterState, targetRaw: string): string;
export function renderQuestDetails(
  char: CharacterState,
  targetRaw: string,
  opts?: { ctx?: any }
): string;
export function renderQuestDetails(
  char: CharacterState,
  targetRaw: string,
  opts: { ctx?: any } = {}
): string {
  const target = (targetRaw || "").trim();
  if (!target) {
    return [
      "Usage:",
      " quest show <#|id|name>",
      "",
      "Tip: Use `quest` to list accepted quests.",
    ].join("\n");
  }

  const prog = ensureProgression(char);
  const kills = (prog.kills as Record<string, number>) || {};
  const harvests = (prog.harvests as Record<string, number>) || {};
  const actions = (prog.actions as Record<string, number>) || {};
  const flags = (prog.flags as Record<string, unknown>) || {};

  const questState = ensureQuestState(char);
  const acceptedIds = Object.keys(questState).sort();

  // Numeric index into accepted quest ordering
  let key = target;
  if (/^\d+$/.test(target)) {
    const idx = Number(target);
    const id = acceptedIds[idx - 1];
    if (id) key = id;
  }

  const resolved = resolveQuestByIdOrNameIncludingAccepted(key, questState);
  if (!resolved) {
    return `[quest] Unknown quest '${target}'.`;
  }
  if (resolved.kind === "ambiguous") {
    return renderQuestAmbiguous(resolved.matches);
  }

  const quest = resolved.quest;
  const entry = questState[quest.id] ?? null;

  const isAccepted = !!entry;
  const state = isAccepted ? String(entry.state ?? "active") : "not_accepted";

  const isCompleted = state === "completed";
  const isTurnedIn = state === "turned_in";

  const isReady = !!(
    isCompleted && areObjectivesSatisfied(quest, char, { kills, harvests, actions, flags })
  );

  const turninHint = isReady
    ? computeTurninHint(opts.ctx, char as any, quest as any, entry)
    : null;

  const mark = isTurnedIn
    ? "[T]"
    : isReady
      ? "[READY]"
      : isCompleted
        ? "[C]"
        : isAccepted
          ? "[A]"
          : "[ ]";

  const lines: string[] = [];
  lines.push(`[quest] ${mark} ${quest.name} (${quest.id})`);
  lines.push(`State: ${state}${isReady ? " (ready)" : ""}`);

  if (quest.description) {
    lines.push("");
    lines.push(quest.description);
  }

  lines.push("");
  lines.push("Objectives:");
  for (const obj of quest.objectives ?? []) {
    lines.push(renderObjectiveLine(char, obj, { kills, harvests, actions, flags }).trimEnd());
  }

  const rewardText = renderQuestRewardSummary(quest);
  if (rewardText) {
    lines.push("");
    lines.push(`Rewards: ${rewardText}`);
  }

  if (isReady) {
    lines.push("");
    if (opts.ctx) {
      lines.push(`Eligible to turn in here: ${turninHint ? "NO" : "YES"}`);
    }
    if (turninHint) {
      lines.push(`Turn-in: ${turninHint}`);
      lines.push(`Then: quest turnin ${quest.id}`);
    } else {
      lines.push(`Turn in with: quest turnin ${quest.id}`);
    }
  }

  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Turn-in hinting (Questloop v0.2)
// ---------------------------------------------------------------------------

function computeTurninHint(
  ctx: any,
  char: any,
  quest: QuestDefinition,
  entry: any
): string | null {
  const policy = String((quest as any).turninPolicy ?? "anywhere").trim() as any;
  if (!policy || policy === "anywhere") return null;

  // Without a ctx, we can still provide a static hint for where to go.
  if (policy === "npc") {
    const npcId = String((quest as any).turninNpcId ?? "").trim();
    if (!ctx) return npcId ? `Go to ${npcId}.` : "Go to the quest NPC.";

    if (!npcId) return "Go to the quest NPC.";

    const roomId = getQuestContextRoomId(ctx, char);
    if (!roomId) return `Go to ${npcId}.`;

    const ents = (ctx?.entities && typeof ctx.entities.getEntitiesInRoom === "function")
      ? (ctx.entities.getEntitiesInRoom(roomId) as any[])
      : [];

    const found = Array.isArray(ents)
      ? ents.some((e) => String(e?.type ?? "") === "npc" && String((e as any)?.protoId ?? "").trim() === npcId)
      : false;

    // If the required NPC is present here, no hint is needed.
    return found ? null : `Go to ${npcId}.`;
  }

  if (policy === "board") {
    const requiredBoard = String((quest as any).turninBoardId ?? "").trim();
    const acceptedTown = String(entry?.source?.townId ?? "").trim();
    const hintTown = requiredBoard || acceptedTown;
    if (!ctx) return hintTown ? `Return to quest board (${hintTown}).` : "Return to a quest board.";

    const townId = getQuestContextTownId(ctx, char);
    if (!townId) return hintTown ? `Return to quest board (${hintTown}).` : "Return to a quest board.";

    if (requiredBoard && requiredBoard !== townId) {
      return `Return to quest board (${requiredBoard}).`;
    }

    // Generated town quests bind to their accepted town.
    if (!requiredBoard && entry?.source?.kind === "generated_town") {
      if (acceptedTown && acceptedTown !== townId) {
        return `Return to quest board (${acceptedTown}).`;
      }
    }

    return null;
  }

  return null;
}

function getQuestContextTownId(ctx: any, char: any): string | null {
  const ent = (ctx?.entities && typeof ctx.entities.getEntityByOwner === "function")
    ? ctx.entities.getEntityByOwner(ctx?.session?.id)
    : null;

  const roomId = String(ent?.roomId ?? "").trim();
  if (!roomId) return null;

  const room = (ctx?.rooms && typeof ctx.rooms.getRoom === "function")
    ? ctx.rooms.getRoom(roomId)
    : null;

  // In Planar War v0, "town" context is currently represented by regionId.
  const townId = String(room?.regionId ?? "").trim();
  return townId || null;
}

type ObjectiveRenderCtx = {
  kills: Record<string, number>;
  harvests: Record<string, number>;
  actions: Record<string, number>;
  flags: Record<string, unknown>;
  // Provided by areObjectivesSatisfied() for collect_item checks.
  // renderObjectiveLine() does not require it.
  inv?: CharacterState["inventory"]; 
};

function renderObjectiveLine(
  char: CharacterState,
  obj: QuestObjective,
  ctx: ObjectiveRenderCtx
): string {
  const { kills, harvests, actions, flags } = ctx;

  switch (obj.kind) {
    case "kill": {
      const raw = kills[obj.targetProtoId] ?? 0;
      const display = Math.min(raw, obj.required);
      return `   - Kill ${obj.required}x ${obj.targetProtoId} (${display}/${obj.required})\n`;
    }

    case "harvest": {
      const raw = harvests[obj.nodeProtoId] ?? 0;
      const display = Math.min(raw, obj.required);
      return `   - Harvest ${obj.required}x ${obj.nodeProtoId} (${display}/${obj.required})\n`;
    }

    case "collect_item": {
      const inv = char.inventory;
      const raw = countItemInInventory(inv, obj.itemId);
      const display = Math.min(raw, obj.required);
      return `   - Bring ${obj.required}x ${obj.itemId} (${display}/${obj.required})\n`;
    }

    case "craft": {
      const raw = actions[obj.actionId] ?? 0;
      const display = Math.min(raw, obj.required);
      return `   - Craft ${obj.required}x ${obj.actionId} (${display}/${obj.required})\n`;
    }

    case "city": {
      const raw = actions[obj.cityActionId] ?? 0;
      const display = Math.min(raw, obj.required);
      return `   - Complete ${obj.required}x ${obj.cityActionId} (${display}/${obj.required})\n`;
    }

    case "talk_to": {
      const required = obj.required ?? 1;
      const key = `talked_to:${obj.npcId}`;
      const v = flags[key];
      const cur = typeof v === "number" ? v : v ? 1 : 0;
      const display = Math.min(cur, required);
      return `   - Talk to ${obj.npcId} (${display}/${required})\n`;
    }

    default:
      return "";
  }
}

function areObjectivesSatisfied(
  quest: { objectives: QuestObjective[] },
  char: CharacterState,
  ctx: Omit<ObjectiveRenderCtx, "inv">,
): boolean {
  const inv = char.inventory;
  for (const obj of quest.objectives ?? []) {
    if (!isObjectiveSatisfied(obj, { ...ctx, inv })) return false;
  }
  return true;
}

function isObjectiveSatisfied(
  obj: QuestObjective,
  ctx: ObjectiveRenderCtx,
): boolean {
  const { kills, harvests, actions, flags, inv } = ctx;

  switch (obj.kind) {
    case "kill":
      return (kills[obj.targetProtoId] ?? 0) >= obj.required;
    case "harvest":
      return (harvests[obj.nodeProtoId] ?? 0) >= obj.required;
    case "collect_item":
      return !!inv && countItemInInventory(inv, obj.itemId) >= obj.required;
    case "craft":
      return (actions[obj.actionId] ?? 0) >= obj.required;
    case "city":
      return (actions[obj.cityActionId] ?? 0) >= obj.required;
    case "talk_to": {
      const required = obj.required ?? 1;
      const key = `talked_to:${obj.npcId}`;
      const v = flags[key];
      const cur = typeof v === "number" ? v : v ? 1 : 0;
      return cur >= required;
    }
    default:
      return false;
  }
}

type QuestResolveResult =
  | { kind: "single"; quest: QuestDefinition }
  | { kind: "ambiguous"; matches: QuestDefinition[] };

function resolveQuestByIdOrNameIncludingAccepted(
  keyRaw: string,
  acceptedState: Record<string, any>,
): QuestResolveResult | null {
  const key = String(keyRaw ?? "").trim();
  if (!key) return null;

  // 1) Exact accepted id (generated or registry accepted)
  if (acceptedState[key]) {
    const q = resolveQuestDefinitionFromStateId(key, acceptedState[key]);
    if (q) return { kind: "single", quest: q };
  }

  // 2) Exact registry id
  const byId = getQuestById(key);
  if (byId) return { kind: "single", quest: byId };

  const lower = key.toLowerCase();

  // Build candidate set: accepted quests + registry quests (unique by id)
  const accepted: QuestDefinition[] = [];
  for (const [id, entry] of Object.entries(acceptedState)) {
    const q = resolveQuestDefinitionFromStateId(id, entry);
    if (q) accepted.push(q);
  }

  const registry = getAllQuests();

  const uniq: QuestDefinition[] = [];
  const seen = new Set<string>();
  for (const q of [...accepted, ...registry]) {
    if (!q || !q.id) continue;
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    uniq.push(q);
  }

  const exact = (q: QuestDefinition) =>
    q.id.toLowerCase() === lower || q.name.toLowerCase() === lower;

  const starts = (q: QuestDefinition) =>
    q.id.toLowerCase().startsWith(lower) || q.name.toLowerCase().startsWith(lower);

  const contains = (q: QuestDefinition) =>
    q.id.toLowerCase().includes(lower) || q.name.toLowerCase().includes(lower);

  // 3) Exact case-insensitive (prefer accepted)
  const exactAccepted = accepted.filter(exact);
  if (exactAccepted.length === 1) return { kind: "single", quest: exactAccepted[0] };
  if (exactAccepted.length > 1) return { kind: "ambiguous", matches: exactAccepted };

  const exactRegistry = registry.filter(exact);
  if (exactRegistry.length === 1) return { kind: "single", quest: exactRegistry[0] };
  if (exactRegistry.length > 1) return { kind: "ambiguous", matches: exactRegistry };

  // 4) Prefix fuzzy (prefer accepted, then registry)
  const prefixAccepted = accepted.filter(starts);
  if (prefixAccepted.length === 1) return { kind: "single", quest: prefixAccepted[0] };
  if (prefixAccepted.length > 1) return { kind: "ambiguous", matches: prefixAccepted };

  const prefixRegistry = registry.filter(starts);
  if (prefixRegistry.length === 1) return { kind: "single", quest: prefixRegistry[0] };
  if (prefixRegistry.length > 1) return { kind: "ambiguous", matches: prefixRegistry };

  // 5) Substring fuzzy across all uniq candidates (bounded)
  const fuzzyAll = uniq.filter(contains);
  if (fuzzyAll.length === 1) return { kind: "single", quest: fuzzyAll[0] };
  if (fuzzyAll.length > 1) return { kind: "ambiguous", matches: fuzzyAll };

  return null;
}

export function renderQuestRewardSummary(quest: QuestDefinition): string {
  const r: any = (quest as any).reward ?? null;
  if (!r) return "";

  const parts: string[] = [];

  if (typeof r.xp === "number" && r.xp > 0) parts.push(`${r.xp} XP`);
  if (typeof r.gold === "number" && r.gold > 0) parts.push(`${r.gold} gold`);

  const items = (r.items as any[]) ?? [];
  for (const it of items) {
    if (!it || !it.itemId) continue;
    const qty = Number(it.quantity ?? 1);
    parts.push(`${qty}x ${it.itemId}`);
  }

  const titles = (r.titles as any[]) ?? [];
  for (const t of titles) {
    if (!t) continue;
    parts.push(`title:${t}`);
  }

  const spellGrants = (r.spellGrants as any[]) ?? [];
  for (const sg of spellGrants) {
    if (!sg || !sg.spellId) continue;
    parts.push(`spell:${sg.spellId}`);
  }

  const abilityGrants = (r.abilityGrants as any[]) ?? [];
  for (const ag of abilityGrants) {
    if (!ag || !ag.abilityId) continue;
    parts.push(`ability:${ag.abilityId}`);
  }

  return parts.join(", ");
}