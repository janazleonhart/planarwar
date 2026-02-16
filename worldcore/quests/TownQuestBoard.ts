// worldcore/quests/TownQuestBoard.ts
//
// Town Quest Board v0
// - Lists deterministic generated quests for the player's current "town context".
// - Accept/abandon flows write to CharacterState progression quest map.
// - Generated quests store source metadata so engine/text/turn-in can resolve them later.

import type { CharacterState } from "../characters/CharacterTypes";
import { ensureQuestState, type QuestSource } from "./QuestState";
import type { QuestDefinition } from "./QuestTypes";
import { generateTownQuests } from "./QuestGenerator";
import { getQuestById, getAllQuests } from "./QuestRegistry";
import { renderQuestAmbiguous, renderQuestDidYouMean } from "./QuestCommandText";

// ----------------------------
// Public API
// ----------------------------

export type TownQuestBoardRenderOpts = {
  /** When true, render only quests that are newly unlocked follow-ups (not yet accepted). */
  onlyNew?: boolean;

  /** When true, render only quests that are available to accept (unaccepted, non-NEW). */
  onlyAvailable?: boolean;

  /** When true, render only quests that are currently active (accepted but not completed). */
  onlyActive?: boolean;

  /** When true, render only quests that are ready to turn in (completed). */
  onlyReady?: boolean;

  /** When true, render only quests that are turned in (completed and handed in). */
  onlyTurned?: boolean;
};

export function countNewUnlockedFollowups(char: CharacterState): number {
  // "NEW" matches the board marker semantics: unlocked follow-ups that the player
  // has not accepted yet.
  const state = ensureQuestState(char);
  const unlocked = computeUnlockedFollowupQuests(char);
  let n = 0;
  for (const q of unlocked) {
    if (!state[q.id]) n++;
  }
  return n;
}


function computeTownQuestBoardOrderedVisibleQuests(
  offeringQuests: QuestDefinition[],
  state: Record<string, any>,
  unlockedFollowups: Set<string>,
  opts?: TownQuestBoardRenderOpts
): QuestDefinition[] {
  const onlyNew = !!opts?.onlyNew;
  const onlyActive = !onlyNew && !!opts?.onlyActive;
  const onlyReady = !onlyNew && !onlyActive && !!opts?.onlyReady;
  const onlyTurned = !onlyNew && !onlyActive && !onlyReady && !!opts?.onlyTurned;
  const onlyAvailable =
    !onlyNew && !onlyActive && !onlyReady && !onlyTurned && !!opts?.onlyAvailable;

  const visibleQuests = onlyNew
    ? offeringQuests.filter((q) => {
        const entry = state[q.id];
        return !entry && unlockedFollowups.has(q.id);
      })
    : onlyAvailable
      ? offeringQuests.filter((q) => {
          const entry = state[q.id];
          // Available == unaccepted AND not a newly-unlocked follow-up.
          // (Option A: keep NEW as its own view so 'available' stays clean.)
          return !entry && !unlockedFollowups.has(q.id);
        })
    : onlyActive
      ? offeringQuests.filter((q) => {
          const entry = state[q.id];
          return !!entry && entry.state === "active";
        })
      : onlyReady
        ? offeringQuests.filter((q) => {
            const entry = state[q.id];
            return !!entry && entry.state === "completed";
          })
        : onlyTurned
          ? offeringQuests.filter((q) => {
              const entry = state[q.id];
              return !!entry && entry.state === "turned_in";
            })
      : offeringQuests;

  // Quest chains v0.5: bubble NEW unlocked follow-ups to the top of the board
  // and then group the remaining quests by status (A/C/T/available).
  //
  // Ordering rules (stable within groups):
  //   1) NEW unlocked follow-ups (not yet accepted)
  //   2) Active [A]
  //   3) Completed/Ready [C]
  //   4) Turned in [T]
  //   5) Available [ ]
  if (onlyNew || onlyAvailable || onlyActive || onlyReady) return visibleQuests;

  const newlyUnlocked: QuestDefinition[] = [];
  const active: QuestDefinition[] = [];
  const completed: QuestDefinition[] = [];
  const turnedIn: QuestDefinition[] = [];
  const available: QuestDefinition[] = [];

  for (const q of visibleQuests) {
    const entry = state[q.id];
    const isNewUnlocked = !entry && unlockedFollowups.has(q.id);

    if (isNewUnlocked) {
      newlyUnlocked.push(q);
      continue;
    }

    if (!entry) {
      available.push(q);
      continue;
    }

    if (entry.state === "active") active.push(q);
    else if (entry.state === "completed") completed.push(q);
    else turnedIn.push(q);
  }

  return newlyUnlocked.concat(active, completed, turnedIn, available);
}

export function listTownQuestBoardQuests(
  ctx: any,
  char: CharacterState,
  opts?: TownQuestBoardRenderOpts
): QuestDefinition[] | null {
  const offering = getTownQuestOffering(ctx, char);
  if (!offering) return null;

  const state = ensureQuestState(char);
  const unlockedFollowups = new Set<string>(computeUnlockedFollowupQuests(char).map((q) => q.id));

  return computeTownQuestBoardOrderedVisibleQuests(offering.quests, state, unlockedFollowups, opts);
}

export function resolveTownQuestFromBoardView(
  ctx: any,
  char: CharacterState,
  idOrIndexOrNameRaw: string,
  opts?: TownQuestBoardRenderOpts
): QuestDefinition | null {
  const offering = getTownQuestOffering(ctx, char);
  if (!offering) return null;

  const q = String(idOrIndexOrNameRaw ?? "").trim();
  if (!q) return null;

  // Index (1-based) uses the same ordering as the rendered board view.
  if (/^\d+$/.test(q)) {
    const list = listTownQuestBoardQuests(ctx, char, opts);
    if (!list) return null;

    const idx = Number(q);
    if (Number.isFinite(idx) && idx >= 1 && idx <= list.length) {
      return list[idx - 1];
    }
    return null;
  }

  // Exact id/name in the underlying offering.
  const exact = resolveFromOffering(offering.quests, q);
  if (exact) return exact;

  const fuzzy = resolveFromOfferingFuzzy(offering.quests, q);
  return fuzzy.length === 1 ? fuzzy[0] : null;
}


export function renderTownQuestBoard(
  ctx: any,
  char: CharacterState,
  opts?: TownQuestBoardRenderOpts
): string {
  const offering = getTownQuestOffering(ctx, char);
  if (!offering) return "[quest] You are nowhere. (No room/town context found.)";


const state = ensureQuestState(char);
// Quest chains v0.4: mark unlocked follow-ups as NEW on the board so players
// notice them immediately.
const unlockedFollowups = new Set<string>(computeUnlockedFollowupQuests(char).map((q) => q.id));
const onlyNew = !!opts?.onlyNew;
const onlyActive = !onlyNew && !!opts?.onlyActive;
const onlyReady = !onlyNew && !onlyActive && !!opts?.onlyReady;
const onlyTurned = !onlyNew && !onlyActive && !onlyReady && !!opts?.onlyTurned;
const onlyAvailable =
  !onlyNew && !onlyActive && !onlyReady && !onlyTurned && !!opts?.onlyAvailable;
const lines: string[] = [];

lines.push(
  `Quest Board: town=${offering.townId} tier=${offering.tier} epoch=${offering.epoch}`
);

const newCountAll = offering.quests.reduce((acc, q) => {
  const entry = state[q.id];
  return !entry && unlockedFollowups.has(q.id) ? acc + 1 : acc;
}, 0);

const orderedVisibleQuests = computeTownQuestBoardOrderedVisibleQuests(
  offering.quests,
  state,
  unlockedFollowups,
  opts
);


  if (onlyNew) lines.push(`NEW quests available: ${orderedVisibleQuests.length}`);
  else if (onlyAvailable) lines.push(`Available quests: ${orderedVisibleQuests.length}`);
  else if (onlyActive) lines.push(`Active quests: ${orderedVisibleQuests.length}`);
  else if (onlyReady) lines.push(`Ready quests: ${orderedVisibleQuests.length}`);
  else if (onlyTurned) lines.push(`Turned-in quests: ${orderedVisibleQuests.length}`);
  else lines.push(`Quests available: ${offering.quests.length} (NEW: ${newCountAll})`);

  if (orderedVisibleQuests.length === 0) {
    lines.push(
      onlyNew
        ? " - No NEW quests available."
        : onlyAvailable
          ? " - No available quests."
        : onlyActive
          ? " - No active quests."
          : onlyReady
            ? " - No ready quests."
            : onlyTurned
              ? " - No turned-in quests."
              : " - No quests available."
    );
    return lines.join("\n");
  }

  orderedVisibleQuests.forEach((q, i) => {
    const entry = state[q.id];
    const status =
      !entry
        ? "[ ]"
        : entry.state === "active"
        ? "[A]"
        : entry.state === "completed"
        ? "[C]"
        : "[T]";

    const isNewUnlocked = !entry && unlockedFollowups.has(q.id);
    const newTag = isNewUnlocked ? "[NEW] " : "";

    const obj = q.objectives?.[0];
    const objText = obj ? summarizeObjective(obj as any) : "Objective: (none)";
    const rewardText = summarizeRewards(q);

    const prereq = describePrereqLock(char, q);

    lines.push(
      ` ${String(i + 1).padStart(2, " ")}. ${status} ${newTag}${q.name} (${q.id})${prereq ? " " + prereq : ""}`
    );
    lines.push(`     - ${objText}`);
    if (rewardText) lines.push(`     - Rewards: ${rewardText}`);
  });

  lines.push("");
  lines.push(
    "Use: quest accept <#|id>   |   quest abandon <#|id>   |   questlog" +
      (onlyNew || onlyAvailable || onlyActive || onlyReady ? "   |   quest board" : "")
  );

  return lines.join("\n").trimEnd();
}

/**
 * Returns the player's current "town quest board context" if they are in a town-tier room.
 *
 * This is intentionally stricter than "regionId exists": many rooms have a regionId, but
 * only rooms tagged with a town tier should count as a quest-board context for turn-ins.
 */
export function getTownContextForTurnin(
  ctx: any,
  char: CharacterState
): { townId: string; tier: number } | null {
  const roomId = getCurrentRoomId(ctx, char);
  if (!roomId) return null;

  // Primary rule: only rooms with an explicit town tier tag count as "board context".
  // This prevents "regionId exists" from accidentally allowing board turn-ins in the wilderness.
  const tier = inferTownTier(ctx, roomId);

  // Back-compat / test-mode fallback:
  // Some unit tests and older MudContext stubs only provide { regionId } without tags.
  // In that case, treat the location as tier-1 town context to preserve older contracts.
  if (tier == null) {
    const rooms = ctx?.rooms;
    if (rooms && typeof rooms.getRoom === "function") {
      const room = rooms.getRoom(roomId);
      const hasRegionId = !!String(room?.regionId ?? room?.region?.id ?? room?.region ?? "").trim();
      const hasTagsArray = Array.isArray(room?.tags);

      if (hasRegionId && !hasTagsArray) {
        const regionId = inferRegionId(ctx, roomId) ?? roomId;
        const townId = regionId;
        return { townId, tier: 1 };
      }
    }

    return null;
  }

  const regionId = inferRegionId(ctx, roomId) ?? roomId;
  const townId = regionId;

  return { townId, tier };
}

/**
 * Resolve a quest from the current town offering context (board) without accepting it.
 *
 * Used by talk-driven UX (ex: `talk <npc> show 1`) so that numeric indices can
 * refer to the town board list even before the quest is accepted.
 */

export function resolveTownQuestFromContext(
  ctx: any,
  char: CharacterState,
  idOrIndexOrNameRaw: string
): QuestDefinition | null {
  // Maintain backward-compat behavior: numeric indices refer to the current board
  // ordering (NEW-first + status-grouped), not raw offering order.
  return resolveTownQuestFromBoardView(ctx, char, idOrIndexOrNameRaw);
}



export async function acceptTownQuest(
  ctx: any,
  char: CharacterState,
  idOrIndexRaw: string,
  opts?: TownQuestBoardRenderOpts
): Promise<string> {
  const offering = getTownQuestOffering(ctx, char);
  if (!offering) return "[quest] Cannot accept: no town context.";

  const query = String(idOrIndexRaw ?? "").trim();
  if (!query) return "Usage: quest accept <#|id|name>";

  // IMPORTANT: numeric indices must match the rendered quest board ordering,
  // not the raw offering array order (which differs once NEW-first sorting exists).
  if (/^\d+$/.test(query)) {
    const fromBoard = resolveTownQuestFromBoardView(ctx, char, query, opts);
    if (fromBoard) {
      return await acceptResolvedQuest(ctx, char, fromBoard, {
        kind: "generated_town",
        townId: offering.townId,
        tier: offering.tier,
        epoch: offering.epoch,
      });
    }
  }

  // Resolution order:
  // 1) Current town offering
  // 2) Static QuestRegistry
  // 3) Backing QuestService (ex: PostgresQuestService) via ctx.quests

  // 1) Offering exact (id/name)
  const fromOfferingExact = /^\d+$/.test(query) ? null : resolveFromOffering(offering.quests, query);
  if (fromOfferingExact)
    return await acceptResolvedQuest(ctx, char, fromOfferingExact, {
      kind: "generated_town",
      townId: offering.townId,
      tier: offering.tier,
      epoch: offering.epoch,
    });

  // 1b) Offering fuzzy (partial id/name)
  const offeringFuzzy = resolveFromOfferingFuzzy(offering.quests, query);
  if (offeringFuzzy.length === 1) {
    return await acceptResolvedQuest(ctx, char, offeringFuzzy[0], {
      kind: "generated_town",
      townId: offering.townId,
      tier: offering.tier,
      epoch: offering.epoch,
    });
  }
  if (offeringFuzzy.length > 1) {
    return renderQuestAmbiguous(offeringFuzzy);
  }

  // 2) Registry exact
  const fromRegistryExact = resolveRegistryQuest(query);
  if (fromRegistryExact)
    return await acceptResolvedQuest(ctx, char, fromRegistryExact, { kind: "registry" });

  // 2b) Registry fuzzy
  const registryFuzzy = resolveRegistryQuestFuzzy(query);
  if (registryFuzzy.length === 1) {
    return await acceptResolvedQuest(ctx, char, registryFuzzy[0], { kind: "registry" });
  }
  if (registryFuzzy.length > 1) {
    return renderQuestAmbiguous(registryFuzzy);
  }

  // 3) Service exact (getQuest) / list scan
  const fromServiceExact = await resolveServiceQuest(ctx, query);
  if (fromServiceExact) {
    return await acceptResolvedQuest(ctx, char, fromServiceExact.quest, {
      kind: "service",
      service: fromServiceExact.service,
      questId: fromServiceExact.quest.id,
      def: fromServiceExact.quest,
    });
  }

  // 3b) Service fuzzy
  const serviceFuzzy = await resolveServiceQuestFuzzy(ctx, query);
  if (serviceFuzzy && serviceFuzzy.matches.length === 1) {
    const q = serviceFuzzy.matches[0];
    return await acceptResolvedQuest(ctx, char, q, {
      kind: "service",
      service: serviceFuzzy.service,
      questId: q.id,
      def: q,
    });
  }
  if (serviceFuzzy && serviceFuzzy.matches.length > 1) {
    return renderQuestAmbiguous(serviceFuzzy.matches);
  }

  // Unknown: show suggestions from offering+registry (cheap, deterministic)
  const suggestions = [...resolveFromOfferingFuzzy(offering.quests, query), ...resolveRegistryQuestFuzzy(query)].slice(
    0,
    8
  );
  if (suggestions.length > 0) {
    return [
      `[quest] Unknown quest '${query}'.`,
      renderQuestDidYouMean(suggestions),
      "(Use 'quest board' to list current town quests.)",
    ].join("\n");
  }

  return `[quest] Unknown quest '${query}'. (Use 'quest board' to list.)`;
}

async function acceptResolvedQuest(
  ctx: any,
  char: CharacterState,
  quest: QuestDefinition,
  source: QuestSource
): Promise<string> {
  const state = ensureQuestState(char);
  const existing = state[quest.id];

  const prereqDenied = describePrereqDeny(char, quest);
  if (prereqDenied) return prereqDenied;

  if (existing) {
    if (existing.state === "active") return `[quest] '${quest.name}' is already active.`;
    if (existing.state === "completed") return `[quest] '${quest.name}' is completed. Turn it in with: quest turnin ${quest.id}`;
    return `[quest] '${quest.name}' is already turned in.`;
  }

  state[quest.id] = {
    state: "active",
    completions: 0,
    source,
  };

  await persistQuestState(ctx, char);

  return `[quest] Accepted: '${quest.name}'. (Use 'questlog' to track progress.)`;
}

// Ambiguity/suggestion formatting lives in QuestCommandText.

export async function abandonQuest(
  ctx: any,
  char: CharacterState,
  idOrIndexRaw: string
): Promise<string> {
  const idOrIndex = String(idOrIndexRaw ?? "").trim();
  if (!idOrIndex) return "Usage: quest abandon <#|id|name>";

  const state = ensureQuestState(char);

  // QoL: allow abandoning by numeric index into the player's quest log ordering.
  // This should work even if the player is not in a town context / board room.
  if (/^\d+$/.test(idOrIndex)) {
    const ids = Object.keys(state).sort();
    const idx = Number(idOrIndex);
    const questId = ids[idx - 1];
    if (questId && state[questId]) {
      const q = resolveQuestDefinitionFromStateId(questId, state[questId]);
      delete state[questId];
      await persistQuestState(ctx, char);
      return q ? `[quest] Abandoned: '${q.name}'.` : `[quest] Abandoned quest '${questId}'.`;
    }
  }

  // Prefer exact id match first.
  if (state[idOrIndex]) {
    const q = resolveQuestDefinitionFromStateId(idOrIndex, state[idOrIndex]);
    delete state[idOrIndex];
    await persistQuestState(ctx, char);
    return q ? `[quest] Abandoned: '${q.name}'.` : `[quest] Abandoned quest '${idOrIndex}'.`;
  }

  // Case-insensitive exact match by id OR name against accepted quests.
  // (Players will naturally type the quest name they see.)
  if (!/^\d+$/.test(idOrIndex)) {
    const accepted = listAcceptedQuestDefs(char);
    const lower = idOrIndex.toLowerCase();
    const exact = accepted.filter(
      (x) => x.id.toLowerCase() === lower || x.name.toLowerCase() === lower
    );
    if (exact.length === 1) {
      delete state[exact[0].id];
      await persistQuestState(ctx, char);
      return `[quest] Abandoned: '${exact[0].name}'.`;
    }
    if (exact.length > 1) {
      return renderQuestAmbiguous(exact);
    }

    // Fuzzy: prefer prefix matches, then substring.
    const prefix = accepted.filter(
      (x) => x.id.toLowerCase().startsWith(lower) || x.name.toLowerCase().startsWith(lower)
    );
    if (prefix.length === 1) {
      delete state[prefix[0].id];
      await persistQuestState(ctx, char);
      return `[quest] Abandoned: '${prefix[0].name}'.`;
    }
    if (prefix.length > 1) {
      return renderQuestAmbiguous(prefix);
    }

    const sub = accepted.filter(
      (x) => x.id.toLowerCase().includes(lower) || x.name.toLowerCase().includes(lower)
    );
    if (sub.length === 1) {
      delete state[sub[0].id];
      await persistQuestState(ctx, char);
      return `[quest] Abandoned: '${sub[0].name}'.`;
    }
    if (sub.length > 1) {
      return renderQuestAmbiguous(sub);
    }
  }

  // If they gave a number, interpret it against the current board.
  const offering = getTownQuestOffering(ctx, char);
  if (offering) {
    const q = resolveTownQuestFromBoardView(ctx, char, idOrIndex);
    if (q && state[q.id]) {
      delete state[q.id];
      await persistQuestState(ctx, char);
      return `[quest] Abandoned: '${q.name}'.`;
    }
  }

  return `[quest] You don't have '${idOrIndex}' accepted.`;
}

function listAcceptedQuestDefs(char: CharacterState): QuestDefinition[] {
  const state = ensureQuestState(char);
  const ids = Object.keys(state).sort();
  const out: QuestDefinition[] = [];
  for (const id of ids) {
    const def = resolveQuestDefinitionFromStateId(id, state[id]);
    if (def) out.push(def);
    else out.push({ id, name: id } as any);
  }
  return out;
}

// Used by engine/text/turn-in to resolve accepted quest definitions without needing ctx.
export function resolveQuestDefinitionFromStateId(
  questId: string,
  entry: any
): QuestDefinition | null {
  const fromRegistry = getQuestById(questId);
  if (fromRegistry) return fromRegistry;

  const src = entry?.source as QuestSource | undefined;
  if (src?.kind === "generated_town") {
    const generated = generateTownQuests({
      townId: src.townId,
      tier: src.tier,
      epoch: src.epoch,
      maxQuests: 12,
      includeRepeatables: true,
    });
    return generated.find((q) => q.id === questId) ?? null;
  }

  if (src?.kind === "service") {
    // Snapshot of a quest fetched from a backing QuestService at accept time.
    return (src as any).def ?? null;
  }

  return null;
}

// ------------------------------------------------------------
// Shared helpers (Questloop v0.2)
// ------------------------------------------------------------

/** Best-effort: resolve the player's current room id for quest/board/turn-in rules. */
export function getQuestContextRoomId(ctx: any, char: any): string | null {
  return getCurrentRoomId(ctx, char);
}

/** Best-effort: resolve the current "town id" (region id) for quest board + turn-in rules. */
export function getQuestContextTownId(ctx: any, char: any): string | null {
  const roomId = getCurrentRoomId(ctx, char);
  if (!roomId) return null;
  const regionId = inferRegionId(ctx, roomId) ?? roomId;
  return regionId ? String(regionId) : null;
}

// ----------------------------
// Internals
// ----------------------------

type TownQuestOffering = {
  townId: string;
  tier: number;
  epoch: string;
  quests: QuestDefinition[];
};

function computeUnlockedFollowupQuests(char: CharacterState): QuestDefinition[] {
  const state = ensureQuestState(char);
  const unlockedIds: string[] = [];

  for (const [questId, entry] of Object.entries(state)) {
    if (!entry) continue;
    if (!hasTurnedInQuest(char, questId)) continue;

    // Prefer registry definition; fall back to service snapshot if present.
    const def =
      getQuestById(questId) ??
      ((entry as any).source?.kind === "service" ? (entry as any).source?.def : null);

    const unlocks = Array.isArray((def as any)?.unlocks) ? (def as any).unlocks : [];
    for (const u of unlocks) {
      const id = String(u ?? "").trim();
      if (id) unlockedIds.push(id);
    }
  }

  const out: QuestDefinition[] = [];
  const seen = new Set<string>();
  for (const id of unlockedIds) {
    if (seen.has(id)) continue;
    seen.add(id);

    const q = getQuestById(id);
    if (q) out.push(q);
  }

  return out;
}

function getTownQuestOffering(ctx: any, char: any): TownQuestOffering | null {
  const roomId = getCurrentRoomId(ctx, char);
  if (!roomId) return null;

  const regionId = inferRegionId(ctx, roomId) ?? roomId;

  // v0 policy: use region id as "town id" key (durable + deterministic).
  const townId = regionId;

  const tier = inferTownTier(ctx, roomId) ?? 1;
  const epoch = inferQuestEpoch();

  const quests = generateTownQuests({
    townId,
    tier,
    epoch,
    maxQuests: undefined,
    includeRepeatables: true,
  });

  // Quest chains v0.3: surface unlocked follow-up quests on the board offering once prerequisites are met.
  const followups = computeUnlockedFollowupQuests(char as any);
  for (const q of followups) {
    if (!quests.some((x) => x.id === q.id)) quests.push(q);
  }

  return { townId, tier, epoch, quests };
}

function resolveFromOffering(quests: QuestDefinition[], idOrIndex: string): QuestDefinition | null {
  const s = idOrIndex.trim();

  // Index (1-based)
  if (/^\d+$/.test(s)) {
    const idx = Number(s);
    if (Number.isFinite(idx) && idx >= 1 && idx <= quests.length) {
      return quests[idx - 1];
    }
  }

  // Exact id
  const byId = quests.find((q) => q.id === s);
  if (byId) return byId;

  // Case-insensitive id or name
  const lower = s.toLowerCase();
  return (
    quests.find((q) => q.id.toLowerCase() === lower) ??
    quests.find((q) => q.name.toLowerCase() === lower) ??
    null
  );
}


function resolveFromOfferingFuzzy(quests: QuestDefinition[], queryRaw: string): QuestDefinition[] {
  const q = String(queryRaw ?? "").trim().toLowerCase();
  if (!q || /^\d+$/.test(q)) return [];

  // Prefer prefix matches, then substring.
  const byPrefix = quests.filter((x) => x.id.toLowerCase().startsWith(q) || x.name.toLowerCase().startsWith(q));
  if (byPrefix.length > 0) return uniqById(byPrefix);
  const bySub = quests.filter((x) => x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
  return uniqById(bySub);
}

function resolveRegistryQuestFuzzy(queryRaw: string): QuestDefinition[] {
  const q = String(queryRaw ?? "").trim().toLowerCase();
  if (!q || /^\d+$/.test(q)) return [];

  const all = getAllQuests();
  const byPrefix = all.filter((x) => x.id.toLowerCase().startsWith(q) || x.name.toLowerCase().startsWith(q));
  if (byPrefix.length > 0) return uniqById(byPrefix);
  const bySub = all.filter((x) => x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
  return uniqById(bySub);
}

async function resolveServiceQuestFuzzy(
  ctx: any,
  queryRaw: string
): Promise<{ matches: QuestDefinition[]; service: string } | null> {
  const raw = String(queryRaw ?? "").trim();
  if (!raw || /^\d+$/.test(raw)) return null;

  const svc = ctx?.quests;
  if (!svc || typeof svc.listQuests !== "function") return null;

  try {
    const all = (await svc.listQuests()) as QuestDefinition[];
    const q = raw.toLowerCase();
    const byPrefix = all.filter((x) => x.id.toLowerCase().startsWith(q) || x.name.toLowerCase().startsWith(q));
    const matches = byPrefix.length > 0 ? byPrefix : all.filter((x) => x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
    return { matches: uniqById(matches), service: String(svc.kind ?? "quests.service") };
  } catch {
    return null;
  }
}

function uniqById(list: QuestDefinition[]): QuestDefinition[] {
  const seen = new Set<string>();
  const out: QuestDefinition[] = [];
  for (const q of list) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}


async function resolveServiceQuest(ctx: any, idOrNameRaw: string): Promise<{ quest: QuestDefinition; service: string } | null> {
  const raw = String(idOrNameRaw ?? "").trim();
  if (!raw) return null;

  const svc = ctx?.quests;
  if (!svc) return null;

  // In tests and certain deployments, quests may be undefined or intentionally disabled.
  // Treat failures as “not found” so the board still works without a DB.
  try {
    // 1) Prefer exact id lookup if available.
    if (typeof svc.getQuest === "function") {
      const q = await svc.getQuest(raw);
      if (q) return { quest: q as QuestDefinition, service: String(svc.kind ?? "quests.service") };
    }

    // 2) Fallback to scan listQuests by id/name (case-insensitive).
    if (typeof svc.listQuests === "function") {
      const all = (await svc.listQuests()) as QuestDefinition[];
      const lower = raw.toLowerCase();
      const byId = all.find((q) => q.id.toLowerCase() === lower);
      if (byId) return { quest: byId, service: String(svc.kind ?? "quests.service") };
      const byName = all.find((q) => q.name.toLowerCase() === lower);
      if (byName) return { quest: byName, service: String(svc.kind ?? "quests.service") };
    }
  } catch {
    return null;
  }

  return null;
}

function resolveRegistryQuest(idOrNameRaw: string): QuestDefinition | null {
  const raw = String(idOrNameRaw ?? '').trim();
  if (!raw || /^\d+$/.test(raw)) return null;

  // Exact id match first
  const byId = getQuestById(raw);
  if (byId) return byId;

  // Case-insensitive id or name match in registry
  const lower = raw.toLowerCase();
  const all = getAllQuests();
  return (
    all.find((q) => q.id.toLowerCase() === lower) ??
    all.find((q) => q.name.toLowerCase() === lower) ??
    null
  );
}

function summarizeObjective(obj: any): string {
  switch (obj.kind) {
    case "kill":
      return `Kill ${obj.required}x ${obj.targetProtoId}`;
    case "harvest":
      return `Harvest ${obj.required}x ${obj.nodeProtoId}`;
    case "collect_item":
      return `Bring ${obj.required}x ${obj.itemId}`;
    case "craft":
      return `Craft ${obj.required}x ${obj.actionId}`;
    case "city":
      return `Complete ${obj.required}x ${obj.cityActionId}`;
    case "talk_to":
      return `Talk to ${renderNpcLabel(obj.npcId)} (${obj.required ?? 1}x)`;
    default:
      return `Objective: ${String(obj.kind ?? "unknown")}`;
  }
}

function renderNpcLabel(npcIdRaw: string): string {
  const npcId = String(npcIdRaw ?? '').trim();
  if (!npcId) return '';

  let base = npcId;
  if (base.startsWith('npc_')) base = base.slice('npc_'.length);
  if (base.startsWith('trainer_')) base = base.slice('trainer_'.length);

  const pretty = base
    .split(/[_\-]+/g)
    .filter(Boolean)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return pretty ? `${pretty} (${npcId})` : npcId;
}

function summarizeRewards(q: QuestDefinition): string {
  const r = q.reward;
  if (!r) return "";
  const bits: string[] = [];
  if (typeof r.xp === "number" && r.xp > 0) bits.push(`${r.xp} XP`);
  if (typeof r.gold === "number" && r.gold > 0) bits.push(`${r.gold} gold`);
  if (r.items && r.items.length > 0) {
    bits.push(r.items.map((it) => `${it.count}x ${it.itemId}`).join(", "));
  }
  if (r.titles && r.titles.length > 0) bits.push(`Titles: ${r.titles.join(", ")}`);
  if (q.repeatable) bits.push(`Repeatable${q.maxCompletions != null ? ` (max ${q.maxCompletions})` : ""}`);
  return bits.join(" • ");
}

function hasTurnedInQuest(char: CharacterState, questId: string): boolean {
  const state = ensureQuestState(char);
  const e = state[questId];
  if (!e) return false;
  if (e.state === "turned_in") return true;
  const completions = Number(e.completions ?? 0);
  return completions > 0;
}

function getQuestNameOrId(questId: string): string {
  const q = getQuestById(questId);
  return q?.name ?? questId;
}

function listMissingPrereqs(char: CharacterState, quest: QuestDefinition): string[] {
  const req = Array.isArray(quest.requiresTurnedIn) ? quest.requiresTurnedIn : [];
  if (req.length === 0) return [];
  return req.filter((id) => !hasTurnedInQuest(char, id));
}

function describePrereqLock(char: CharacterState, quest: QuestDefinition): string | null {
  const missing = listMissingPrereqs(char, quest);
  if (missing.length === 0) return null;
  const names = missing.map(getQuestNameOrId).join(", ");
  return `(LOCKED: requires ${names})`;
}

function describePrereqDeny(char: CharacterState, quest: QuestDefinition): string | null {
  const missing = listMissingPrereqs(char, quest);
  if (missing.length === 0) return null;

  const names = missing.map(getQuestNameOrId).join(", ");
  return `[quest] Cannot accept '${quest.name}': requires you to turn in ${names} first.`;
}

function getCurrentRoomId(ctx: any, char: any): string | null {
  // Preferred: the player’s “body” entity owns the authoritative roomId.
  const sessId = ctx?.session?.id;
  const entities = ctx?.entities;

  if (sessId && entities && typeof entities.getEntityByOwner === "function") {
    const selfEnt = entities.getEntityByOwner(sessId);
    const rid = selfEnt?.roomId;
    if (rid) return String(rid);
  }

  // Fallbacks
  return (
    char?.roomId ??
    char?.position?.roomId ??
    char?.state?.roomId ??
    char?.location?.roomId ??
    ctx?.session?.roomId ??
    ctx?.session?.state?.roomId ??
    null
  );
}

function inferRegionId(ctx: any, roomId: string): string | null {
  const rooms = ctx?.rooms;
  if (rooms && typeof rooms.getRoom === "function") {
    const room = rooms.getRoom(roomId);
    const rid =
      room?.regionId ??
      room?.region?.id ??
      room?.region ??
      null;
    if (rid) return String(rid);
  }
  // Many deployments use roomId == regionId.
  return roomId || null;
}

function inferTownTier(ctx: any, roomId: string): number | null {
  // 1) Room tag heuristic
  const rooms = ctx?.rooms;
  if (rooms && typeof rooms.getRoom === "function") {
    const room = rooms.getRoom(roomId);
    const tags = Array.isArray(room?.tags) ? room.tags.map((t: any) => String(t)) : [];
    for (const t of tags) {
      const m = String(t).match(/town[_-]?tier[_-]?(\d+)/i);
      if (m) return Math.max(1, Number(m[1]));
    }
  }

  // 2) Best-effort world helpers if they exist
  const w = ctx?.world;
  const candidates = [
    w?.townTierRules,
    w?.townBaselines,
    w,
  ].filter(Boolean);

  const fnNames = [
    "getTownTierForRoom",
    "inferTownTierForRoom",
    "getTierForRoom",
    "getTownTier",
    "inferTownTier",
  ];

  for (const obj of candidates) {
    for (const fn of fnNames) {
      if (obj && typeof (obj as any)[fn] === "function") {
        try {
          const n = (obj as any)[fn](roomId);
          if (Number.isFinite(n)) return Math.max(1, Number(n));
        } catch {
          // ignore
        }
      }
    }
  }

  return null;
}

function inferQuestEpoch(): string {
  const fromEnv =
    process.env.PW_QUEST_EPOCH ??
    process.env.PW_TOWN_QUEST_EPOCH ??
    process.env.WORLD_QUEST_EPOCH ??
    "";

  const trimmed = String(fromEnv).trim();
  if (trimmed) return trimmed;

  // ISO-week-ish epoch: YYYY-W##
  const d = new Date();
  const { year, week } = isoWeek(d);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ISO week (Monday-based)
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

async function persistQuestState(ctx: any, char: any): Promise<void> {
  if (!ctx?.characters) return;
  try {
    await ctx.characters.patchCharacter(char.userId, char.id, {
      progression: char.progression,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to patch character after quest state change", {
      err,
      charId: char.id,
    });
  }
}