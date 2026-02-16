// worldcore/quests/TownQuestBoard.ts
//
// Town Quest Board v0
// - Lists deterministic generated quests for the player's current "town context".
// - Accept/abandon flows write to CharacterState progression quest map.
// - Generated quests store source metadata so engine/text/turn-in can resolve them later.

import type { CharacterState } from "../characters/CharacterTypes";
import { ensureQuestState, type QuestSource } from "./QuestState";
import type { QuestDefinition } from "./QuestTypes";
import {
  generateTownQuests,
  getDefaultTownQuestGeneratorTuning,
  type TownQuestGeneratorTuning,
} from "./QuestGenerator";
import { getQuestById, getAllQuests } from "./QuestRegistry";
import { renderQuestAmbiguous, renderQuestDidYouMean } from "./QuestCommandText";

// ----------------------------
// Quest board rotation memory (v0.15)
// ----------------------------

// Keep this small: it lives on the character state and should be cheap to persist.
const QUEST_BOARD_ROTATION_MAX = 18;
const QUEST_BOARD_SHAPE_ROTATION_MAX = 18;

function clampInt(n: number, lo: number, hi: number): number {
  const x = Math.trunc(Number.isFinite(n) ? n : lo);
  return Math.min(hi, Math.max(lo, x));
}

function clamp01(n: unknown, fallback: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(1, x));
}

// These are onboarding staples. They should not be rotated out.
function isRotationImmuneQuestId(id: string): boolean {
  const s = String(id ?? "").toLowerCase();
  return s.includes("greet_quartermaster") || s.includes("rat_culling");
}


// Follow-up parent rotation memory (v0.18)
//
// This is a tiny helper to avoid showing NEW follow-ups from the same parent chain
// on consecutive board refreshes when there are multiple chains available.
const QUEST_BOARD_FOLLOWUP_PARENT_ROTATION_MAX = 8;

function getRecentFollowupParentIds(char: any, rotationKey: string, epoch: string): string[] {
  const prog = (char.progression ??= {});
  const history = (prog.questBoardHistory ??= {});

  const cur = history[rotationKey];
  if (!cur || cur.epoch !== epoch) {
    history[rotationKey] = { epoch, ids: [] as string[] };
    return [];
  }

  const ids = Array.isArray(cur.ids) ? cur.ids : [];
  if (ids.length > QUEST_BOARD_FOLLOWUP_PARENT_ROTATION_MAX) {
    cur.ids = ids.slice(-QUEST_BOARD_FOLLOWUP_PARENT_ROTATION_MAX);
  }
  return cur.ids;
}

function recordQuestBoardFollowupParents(
  char: any,
  rotationKey: string,
  epoch: string,
  parentIds: string[]
): void {
  const prog = (char.progression ??= {});
  const history = (prog.questBoardHistory ??= {});

  const cur = history[rotationKey];
  if (!cur || cur.epoch !== epoch) {
    history[rotationKey] = { epoch, ids: [] as string[] };
  }

  const slot = history[rotationKey];
  const ids: string[] = Array.isArray(slot.ids) ? slot.ids.slice() : [];

  const sample = Array.isArray(parentIds) ? parentIds.slice(0, 6) : [];
  for (const raw of sample) {
    const id = String(raw ?? "").trim();
    if (!id) continue;

    const existingIdx = ids.indexOf(id);
    if (existingIdx >= 0) ids.splice(existingIdx, 1);
    ids.push(id);

    if (ids.length > QUEST_BOARD_FOLLOWUP_PARENT_ROTATION_MAX) {
      ids.splice(0, ids.length - QUEST_BOARD_FOLLOWUP_PARENT_ROTATION_MAX);
    }
  }

  slot.ids = ids;
}
function getRecentOfferedQuestIds(char: any, rotationKey: string, epoch: string): string[] {
  const prog = (char.progression ??= {});
  const history = (prog.questBoardHistory ??= {});

  const cur = history[rotationKey];
  if (!cur || cur.epoch !== epoch) {
    history[rotationKey] = { epoch, ids: [] as string[] };
    return [];
  }

  const ids = Array.isArray(cur.ids) ? cur.ids : [];
  // Defensive clamp.
  if (ids.length > QUEST_BOARD_ROTATION_MAX) {
    cur.ids = ids.slice(-QUEST_BOARD_ROTATION_MAX);
  }
  return cur.ids;
}


function getRecentOfferedStrings(char: any, rotationKey: string, epoch: string): string[] {
  const prog = (char.progression ??= {});
  const history = (prog.questBoardHistory ??= {});

  const cur = history[rotationKey];
  if (!cur || cur.epoch !== epoch) {
    history[rotationKey] = { epoch, ids: [] as string[] };
    return [];
  }

  const ids = Array.isArray(cur.ids) ? cur.ids : [];
  // Defensive clamp.
  if (ids.length > QUEST_BOARD_SHAPE_ROTATION_MAX) {
    cur.ids = ids.slice(-QUEST_BOARD_SHAPE_ROTATION_MAX);
  }
  return cur.ids;
}

function recordQuestBoardStrings(char: any, rotationKey: string, epoch: string, values: string[]): void {
  const prog = (char.progression ??= {});
  const history = (prog.questBoardHistory ??= {});

  const cur = history[rotationKey];
  if (!cur || cur.epoch !== epoch) {
    history[rotationKey] = { epoch, ids: [] as string[] };
  }

  const slot = history[rotationKey];
  const ids: string[] = Array.isArray(slot.ids) ? slot.ids.slice() : [];

  const sample = Array.isArray(values) ? values.slice(0, 24) : [];
  for (const raw of sample) {
    const v = String(raw ?? "").trim();
    if (!v) continue;

    const existingIdx = ids.indexOf(v);
    if (existingIdx >= 0) ids.splice(existingIdx, 1);
    ids.push(v);

    if (ids.length > QUEST_BOARD_SHAPE_ROTATION_MAX) {
      ids.splice(0, ids.length - QUEST_BOARD_SHAPE_ROTATION_MAX);
    }
  }

  slot.ids = ids;
}


function recordQuestBoardOffering(char: any, rotationKey: string, epoch: string, offeredQuestIds: string[]): void {
  const prog = (char.progression ??= {});
  const history = (prog.questBoardHistory ??= {});

  const cur = history[rotationKey];
  if (!cur || cur.epoch !== epoch) {
    history[rotationKey] = { epoch, ids: [] as string[] };
  }

  const slot = history[rotationKey];
  const ids: string[] = Array.isArray(slot.ids) ? slot.ids.slice() : [];

  // We only need a sample from the current offering; storing the whole catalog is wasteful.
  const sample = Array.isArray(offeredQuestIds) ? offeredQuestIds.slice(0, 12) : [];

  for (const raw of sample) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (isRotationImmuneQuestId(id)) continue;

    const existingIdx = ids.indexOf(id);
    if (existingIdx >= 0) ids.splice(existingIdx, 1);
    ids.push(id);

    if (ids.length > QUEST_BOARD_ROTATION_MAX) {
      ids.splice(0, ids.length - QUEST_BOARD_ROTATION_MAX);
    }
  }

  slot.ids = ids;
}

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

  /** Staff-only: when true, include debug metadata lines for each quest. */
  debug?: boolean;
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

    if (opts?.debug) {
      const sig = computeObjectiveSignature(q);
      const fams = computeResourceFamilies(q);
      const sem = computeSemanticKeys(q);
      const bits: string[] = [];
      if (sig) bits.push(`sig=${sig}`);
      if (fams.length) bits.push(`fam=${fams.join(",")}`);
      if (sem.length) bits.push(`sem=${sem.slice(0, 6).join(",")}`);
      if (bits.length) lines.push(`     { ${bits.join(" ")} }`);
    }
  });

  lines.push("");
  lines.push(
    "Use: quest board help   |   quest board [available|new|active|ready|turned]"
  );
  lines.push(
    "     quest board show <#|id|name>   |   quest board accept <#|id|name>   |   quest board preview <#|id|name>   |   quest board turnin <#|id|name>   |   questlog"
  );

  return lines.join("\n").trimEnd();
}

function computeObjectiveSignature(q: QuestDefinition): string {
  const kinds = Array.isArray((q as any).objectives)
    ? (q as any).objectives
        .map((o: any) => String(o?.kind ?? "").trim())
        .filter(Boolean)
    : [];
  if (!kinds.length) return "";
  return kinds.join("+");
}

function computeSemanticKeys(q: QuestDefinition): string[] {
  const out: string[] = [];
  const objs: any[] = Array.isArray((q as any).objectives) ? (q as any).objectives : [];
  for (const o of objs) {
    const kind = String(o?.kind ?? "");
    if (kind === "kill") {
      const id = o?.targetProtoId ?? o?.protoId ?? null;
      if (id) out.push(`kill:${id}`);
    } else if (kind === "harvest") {
      const id = o?.nodeProtoId ?? o?.resourceProtoId ?? null;
      if (id) out.push(`harvest:${id}`);
    } else if (kind === "collect_item") {
      const id = o?.itemId ?? null;
      if (id) out.push(`collect_item:${id}`);
    } else if (kind === "talk_to") {
      const id = o?.npcId ?? null;
      if (id) out.push(`talk_to:${id}`);
    } else if (kind === "vein_report") {
      const id = o?.nodeProtoId ?? o?.veinProtoId ?? o?.resourceProtoId ?? null;
      if (id) out.push(`vein_report:${id}`);
    }
  }
  return out;
}

function computeResourceFamilies(q: QuestDefinition): string[] {
  const fams = new Set<string>();
  const objs: any[] = Array.isArray((q as any).objectives) ? (q as any).objectives : [];

  const addFromId = (idRaw: any) => {
    const id = String(idRaw ?? "").trim();
    if (!id) return;
    const prefix = id.split("_")[0];
    if (!prefix) return;
    if (["herb", "wood", "ore", "stone", "grain", "fish", "mana"].includes(prefix)) fams.add(prefix);
  };

  for (const o of objs) {
    const kind = String(o?.kind ?? "");
    if (kind === "harvest") addFromId(o?.nodeProtoId ?? o?.resourceProtoId);
    if (kind === "collect_item") addFromId(o?.itemId);
    if (kind === "vein_report") addFromId(o?.nodeProtoId ?? o?.veinProtoId ?? o?.resourceProtoId);
  }

  return Array.from(fams).sort();
}

/**
 * Returns the player's current "town quest board context" if they are in a town-tier room.
 *
 * This is intentionally stricter than "regionId exists": many rooms have a regionId, but
 * only rooms tagged with a town tier should count as a quest-board context for turn-ins.
 */

export function renderTownQuestBoardDebugCaps(ctx: any, char: any): string {
  const data = getTownQuestBoardDebugCapsData(ctx, char);
  if (!data) return "[quest] No town context.";

  const lines: string[] = [];
  lines.push("Quest Board Debug Caps (staff):");
  lines.push(` - townId: ${data.townId}`);
  lines.push(` - tier: ${data.tier}`);
  lines.push(` - epoch: ${data.epoch}`);
  lines.push(` - rotationKey: ${data.rotationKey}`);
  lines.push(` - recentOfferedIds: ${data.recentOfferedIds.length ? data.recentOfferedIds.join(", ") : "(none)"}`);
  lines.push(` - recentObjectiveSignatures: ${data.recentObjectiveSignatures.length ? data.recentObjectiveSignatures.join(", ") : "(none)"}`);
  lines.push(` - recentResourceFamilies: ${data.recentResourceFamilies.length ? data.recentResourceFamilies.join(", ") : "(none)"}`);
  lines.push(` - recentFollowupParents: ${data.recentFollowupParentIds.length ? data.recentFollowupParentIds.join(", ") : "(none)"}`);

  return lines.join("\n").trimEnd();
}

/**
 * Staff-only: show the *effective* generator tuning for the current town context.
 *
 * This does not expose hidden quest pools; it only prints cap/rotation knobs.
 */
export function renderTownQuestBoardDebugTuning(ctx: any, char: any): string {
  const data = getTownQuestBoardDebugCapsData(ctx, char);
  if (!data) return "[quest] No town context.";

  const roomId = getQuestContextRoomId(ctx, char);
  const profileTags = roomId ? getTownQuestBoardProfileTags(ctx, roomId) : [];
  const profileName = pickTownQuestBoardProfile(profileTags);
  const tuningPresetTags = roomId ? getTownQuestBoardTuningPresetTags(ctx, roomId) : [];
  const tuningPreset = pickTownQuestBoardTuningPreset(tuningPresetTags);

  // Mirror generator defaults (QuestGenerator.ts) so staff can see what is in play.
  const tier = Math.max(1, Math.floor(data.tier || 1));
  const defaultMax = clampInt(2 + Math.min(tier, 4), 3, 6);
  const base = getDefaultTownQuestGeneratorTuning({ tier, maxQuests: defaultMax });
  const profileForSources =
    profileName === "arcane" || profileName === "military" || profileName === "trade" ? profileName : null;
  const { overrides, sources } = computeTownQuestBoardTuningOverridesAndSources(tier, profileForSources, tuningPreset);
  const tuning: TownQuestGeneratorTuning = { ...base, ...overrides };

  const srcOf = (k: keyof TownQuestGeneratorTuning): string => {
    const key = String(k);
    const has = Object.prototype.hasOwnProperty.call(overrides, key);
    return has ? sources[key] ?? "override" : "base";
  };

  const lines: string[] = [];
  lines.push("Quest Board Debug Tuning (staff):");
  lines.push(` - townId: ${data.townId}`);
  lines.push(` - tier: ${data.tier}`);
  lines.push(` - epoch: ${data.epoch}`);
  lines.push(` - maxQuests(default): ${defaultMax}`);
  lines.push(` - profileTags: ${profileTags.length ? profileTags.join(", ") : "(none)"}`);
  lines.push(` - profile: ${profileName ?? "(none)"}`);
  lines.push(` - tuningPresetTags: ${tuningPresetTags.length ? tuningPresetTags.join(", ") : "(none)"}`);
  lines.push(` - tuningPreset: ${tuningPreset ?? "(none)"}`);
  lines.push(
    ` - overrides: ${Object.keys(overrides).length ? Object.keys(overrides).sort().join(", ") : "(none)"}`
  );
  lines.push(` - kindBaseCap: ${tuning.kindBaseCap} (${srcOf("kindBaseCap")})`);
  lines.push(` - signatureBaseCap: ${tuning.signatureBaseCap} (${srcOf("signatureBaseCap")})`);
  lines.push(` - semanticBaseCap: ${tuning.semanticBaseCap} (${srcOf("semanticBaseCap")})`);
  lines.push(` - familyBaseCap: ${tuning.familyBaseCap} (${srcOf("familyBaseCap")})`);
  lines.push(` - avoidRecentUntilFrac: ${tuning.avoidRecentUntilFrac} (${srcOf("avoidRecentUntilFrac")})`);
  lines.push(` - avoidRecentShapesUntilFrac: ${tuning.avoidRecentShapesUntilFrac} (${srcOf("avoidRecentShapesUntilFrac")})`);
  return lines.join("\n").trimEnd();
}

function getTownQuestBoardProfileTags(ctx: any, roomId: string): string[] {
  try {
    const rooms = ctx?.rooms;
    if (!rooms || typeof rooms.getRoom !== "function") return [];
    const room = rooms.getRoom(roomId);
    const tags = Array.isArray(room?.tags) ? (room.tags as any[]) : [];
    return tags
      .filter((t) => typeof t === "string" && t.startsWith("town_profile_"))
      .map((t) => String(t))
      .sort();
  } catch {
    return [];
  }
}

function getTownQuestBoardTuningPresetTags(ctx: any, roomId: string): string[] {
  try {
    const rooms = ctx?.rooms;
    if (!rooms || typeof rooms.getRoom !== "function") return [];
    const room = rooms.getRoom(roomId);
    const tags = Array.isArray(room?.tags) ? (room.tags as any[]) : [];
    return tags
      .filter((t) => typeof t === "string" && t.startsWith("town_tuning_"))
      .map((t) => String(t))
      .sort();
  } catch {
    return [];
  }
}

function pickTownQuestBoardTuningPreset(tags: string[]): "strict" | "loose" | "chaos" | null {
  if (!tags || tags.length === 0) return null;
  // Deterministic: choose the first matching tag in sorted order.
  for (const t of tags) {
    if (t === "town_tuning_strict") return "strict";
    if (t === "town_tuning_loose") return "loose";
    if (t === "town_tuning_chaos") return "chaos";
  }
  return null;
}


function pickTownQuestBoardProfile(profileTags: string[]): "arcane" | "military" | "trade" | null {
  if (!profileTags || profileTags.length === 0) return null;
  // Deterministic priority order if multiple tags exist.
  if (profileTags.includes("town_profile_arcane")) return "arcane";
  if (profileTags.includes("town_profile_military")) return "military";
  if (profileTags.includes("town_profile_trade")) return "trade";
  return null;
}

// v0.29/v0.30: tier-based tuning activation + optional town profile overrides.
//
// These overrides are intentionally modest. Tier 1 remains conservative onboarding.
// Higher tiers nudge harder toward variety/rotation fairness.
function computeTownQuestBoardTuningOverridesAndSources(
  tier: number,
  profile: "arcane" | "military" | "trade" | null,
  tuningPreset: "strict" | "loose" | "chaos" | null
): { overrides: Partial<TownQuestGeneratorTuning>; sources: Record<string, string> } {
  const t = Math.max(1, Math.floor(Number.isFinite(tier) ? tier : 1));
  const sources: Record<string, string> = {};
  let overrides: Partial<TownQuestGeneratorTuning> = {};

  const set = (k: keyof TownQuestGeneratorTuning, v: any, src: string) => {
    (overrides as any)[k] = v;
    sources[String(k)] = src;
  };

  // Base tier overrides.
  if (t === 2) {
    set("avoidRecentUntilFrac", 0.8 as any, `tier:${t}`);
    set("avoidRecentShapesUntilFrac", 0.85 as any, `tier:${t}`);
  } else if (t >= 3) {
    set("avoidRecentUntilFrac", 0.85 as any, `tier:${t}`);
    set("avoidRecentShapesUntilFrac", 0.9 as any, `tier:${t}`);
  }

  // Profile overrides: gentle nudges that do NOT affect player-facing text.
  // These only influence selection preference when the pool allows.
  if (profile === "arcane") {
    set(
      "avoidRecentShapesUntilFrac",
      clamp01((overrides.avoidRecentShapesUntilFrac ?? 0) + 0.05, overrides.avoidRecentShapesUntilFrac ?? 0) as any,
      "profile:arcane"
    );
  } else if (profile === "military") {
    set(
      "avoidRecentUntilFrac",
      clamp01((overrides.avoidRecentUntilFrac ?? 0) + 0.05, overrides.avoidRecentUntilFrac ?? 0) as any,
      "profile:military"
    );
  } else if (profile === "trade") {
    set(
      "avoidRecentShapesUntilFrac",
      clamp01((overrides.avoidRecentShapesUntilFrac ?? 0) + 0.03, overrides.avoidRecentShapesUntilFrac ?? 0) as any,
      "profile:trade"
    );
  }

  // Tuning preset overrides: explicit tags that can intentionally shift board feel.
  // Applied last so they win over tier/profile nudges.
  if (tuningPreset === "strict") {
    set(
      "avoidRecentUntilFrac",
      clamp01(Math.max(overrides.avoidRecentUntilFrac ?? 0, 0.92), overrides.avoidRecentUntilFrac ?? 0) as any,
      "preset:strict"
    );
    set(
      "avoidRecentShapesUntilFrac",
      clamp01(Math.max(overrides.avoidRecentShapesUntilFrac ?? 0, 0.94), overrides.avoidRecentShapesUntilFrac ?? 0) as any,
      "preset:strict"
    );
  } else if (tuningPreset === "loose") {
    set(
      "avoidRecentUntilFrac",
      clamp01(Math.min(overrides.avoidRecentUntilFrac ?? 0, 0.75), overrides.avoidRecentUntilFrac ?? 0) as any,
      "preset:loose"
    );
    set(
      "avoidRecentShapesUntilFrac",
      clamp01(Math.min(overrides.avoidRecentShapesUntilFrac ?? 0, 0.8), overrides.avoidRecentShapesUntilFrac ?? 0) as any,
      "preset:loose"
    );
  } else if (tuningPreset === "chaos") {
    // Chaos: allow repetition earlier; still clamped by generator.
    set(
      "avoidRecentUntilFrac",
      clamp01(Math.min(overrides.avoidRecentUntilFrac ?? 0, 0.6), overrides.avoidRecentUntilFrac ?? 0) as any,
      "preset:chaos"
    );
    set(
      "avoidRecentShapesUntilFrac",
      clamp01(Math.min(overrides.avoidRecentShapesUntilFrac ?? 0, 0.65), overrides.avoidRecentShapesUntilFrac ?? 0) as any,
      "preset:chaos"
    );
  }

  return { overrides, sources };
}

function getTownQuestBoardTuningOverrides(
  tier: number,
  profile: "arcane" | "military" | "trade" | "strict" | "loose" | "chaos" | null,
  tuningPreset: "strict" | "loose" | "chaos" | null
): Partial<TownQuestGeneratorTuning> {
  // Keep the generation path stable; only the debug path needs sources.
  const p = profile === "arcane" || profile === "military" || profile === "trade" ? profile : null;
  return computeTownQuestBoardTuningOverridesAndSources(tier, p, tuningPreset).overrides;
}


function computeQuestBoardRotationSeamKey(ctx: any, roomId: string, tier: number): string {
  // v0.33: seam-key rotation history by tuning regime to prevent old history from "poisoning" new tuning settings.
  const profileTags = getTownQuestBoardProfileTags(ctx, roomId);
  const profileName = pickTownQuestBoardProfile(profileTags) ?? "none";

  const tuningPresetTags = getTownQuestBoardTuningPresetTags(ctx, roomId);
  const tuningPreset = pickTownQuestBoardTuningPreset(tuningPresetTags) ?? "none";

  // Tier is already present in rotationKey, but include it in seam for extra safety against future refactors.
  return `seam:${tier}|p:${profileName}|preset:${tuningPreset}`;
}

export type TownQuestBoardDebugCapsData = {
  townId: string;
  tier: number;
  epoch: string;
  rotationKey: string;
  recentOfferedIds: string[];
  recentObjectiveSignatures: string[];
  recentResourceFamilies: string[];
  recentFollowupParentIds: string[];
};

export function getTownQuestBoardDebugCapsData(ctx: any, char: any): TownQuestBoardDebugCapsData | null {
  // Staff-only wrapper exists in questsCommand; this function is pure data.
  const roomId = getQuestContextRoomId(ctx, char);
  const townId = roomId ? inferRegionId(ctx, roomId) : null;
  if (!townId) return null;

  const tier = inferTownTier(ctx, townId) ?? 1;
  const epoch = inferQuestEpoch();

	// `roomId` is nullable, but by the time we have a `townId` it should be present.
	// Keep this defensive so TypeScript (and future refactors) don't explode.
	const safeRoomId = roomId ?? "unknown_room";
	const seamKey = computeQuestBoardRotationSeamKey(ctx, safeRoomId, tier);

  const rotationKey = `town:${townId}|t${tier}|${seamKey}`;
  const recentOfferedIds = getRecentOfferedQuestIds(char as any, rotationKey, epoch);

  // v0.26: fairness weighting across rotations (quest shapes).
  const sigKey = `${rotationKey}|sigs`;
  const famKey = `${rotationKey}|families`;
  const recentObjectiveSignatures = getRecentOfferedStrings(char as any, sigKey, epoch);
  const recentResourceFamilies = getRecentOfferedStrings(char as any, famKey, epoch);

  const followupRotationKey = `${rotationKey}|followupParents`;
  const recentFollowupParentIds = getRecentFollowupParentIds(char as any, followupRotationKey, epoch);

  return {
    townId,
    tier,
    epoch,
    rotationKey,
    recentOfferedIds,
    recentObjectiveSignatures,
    recentResourceFamilies,
    recentFollowupParentIds,
  };
}

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

      // IMPORTANT: do NOT treat `tags: []` as town context.
      // Empty tags means "explicitly no tags" and should deny board turn-ins.
      // The fallback is ONLY for older stubs that omit tags entirely.
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
  if (src?.kind === "generated_town" || src?.kind === "generated") {
    const generated = generateTownQuests({
      townId: src.townId,
      tier: src.tier,
      epoch: src.epoch,
      maxQuests: 12,
      includeRepeatables: true,
      includeChainCatalog: true,
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

    // Resolve the definition for the quest that was turned in.
    // This supports BOTH registry quests and generated town quests.
    const def =
      getQuestById(questId) ??
      resolveQuestDefinitionFromStateId(questId, entry as any) ??
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

    // 1) Registry quest
    const q = getQuestById(id);
    if (q) {
      out.push(q);
      continue;
    }

    // 2) Generated-town follow-up (deterministic catalog lookup)
    //
    // For generated quests, follow-ups live inside the same generated catalog
    // for the town/tier/epoch that produced the quest that unlocked them.
    const unlocked = resolveGeneratedUnlockedQuestFromState(char, id);
    if (unlocked) out.push(unlocked);
  }

  return out;
}

// Build a deterministic mapping of unlocked follow-up questId -> parent questIds that unlocked it.
// Used for board density shaping so we can surface follow-ups from different chains first.
function computeUnlockedFollowupParents(char: CharacterState): Map<string, string[]> {
  const state = ensureQuestState(char);
  const map = new Map<string, string[]>();

  for (const [questId, entry] of Object.entries(state)) {
    if (!entry) continue;
    if (!hasTurnedInQuest(char, questId)) continue;

    const def =
      getQuestById(questId) ??
      resolveQuestDefinitionFromStateId(questId, entry as any) ??
      ((entry as any).source?.kind === "service" ? (entry as any).source?.def : null);

    const unlocks = Array.isArray((def as any)?.unlocks) ? (def as any).unlocks : [];
    for (const u of unlocks) {
      const id = String(u ?? "").trim();
      if (!id) continue;
      const cur = map.get(id);
      if (!cur) map.set(id, [questId]);
      else if (!cur.includes(questId)) cur.push(questId);
    }
  }

  // Deterministic ordering of parent lists.
  for (const [k, parents] of map.entries()) {
    parents.sort((a, b) => a.localeCompare(b));
    map.set(k, parents);
  }

  return map;
}

function resolveGeneratedUnlockedQuestFromState(
  char: CharacterState,
  unlockedQuestId: string
): QuestDefinition | null {
  const state = ensureQuestState(char);

  for (const entry of Object.values(state)) {
    const src = (entry as any)?.source;
    if (!src) continue;

    if (src.kind !== "generated_town" && src.kind !== "generated") continue;

    // Generate a large catalog so "maxQuests" on the board doesn't hide follow-ups.
    const catalog = generateTownQuests({
      townId: src.townId,
      tier: src.tier,
      epoch: src.epoch,
      maxQuests: 50,
      includeRepeatables: true,
      includeChainCatalog: true,
    });

    const found = catalog.find((q) => q.id === unlockedQuestId);
    if (found) return found;
  }

  return null;
}


function objectiveSignatureOfQuest(q: QuestDefinition): string {
  const objs: any[] = Array.isArray((q as any).objectives) ? ((q as any).objectives as any[]) : [];
  if (objs.length === 0) return "sig:empty";
  return `sig:${objs.map((o) => (o && typeof o.kind === "string" ? o.kind : "unknown")).join("+")}`;
}

function semanticFamilyKeysOfQuest(q: QuestDefinition): string[] {
  const objs: any[] = Array.isArray((q as any).objectives) ? ((q as any).objectives as any[]) : [];
  const out: string[] = [];

  const famOfId = (id: string): string | null => {
    const s = String(id);
    if (s.startsWith("herb_")) return "herb";
    if (s.startsWith("wood_")) return "wood";
    if (s.startsWith("ore_")) return "ore";
    if (s.startsWith("stone_")) return "stone";
    if (s.startsWith("grain_")) return "grain";
    if (s.startsWith("fish_")) return "fish";
    if (s.startsWith("mana_")) return "mana";
    return null;
  };

  for (const o of objs) {
    if (!o || typeof o.kind !== "string") continue;
    if (o.kind === "harvest" && typeof o.nodeProtoId === "string") {
      const fam = famOfId(o.nodeProtoId);
      if (fam) out.push(`resfam:${fam}`);
    } else if (o.kind === "vein_report") {
      const id =
        typeof o.nodeProtoId === "string"
          ? o.nodeProtoId
          : typeof o.veinProtoId === "string"
            ? o.veinProtoId
            : typeof o.resourceProtoId === "string"
              ? o.resourceProtoId
              : null;
      if (id) {
        const fam = famOfId(id);
        if (fam) out.push(`resfam:${fam}`);
      }
    } else if (o.kind === "collect_item" && typeof o.itemId === "string") {
      const fam = famOfId(o.itemId);
      if (fam) out.push(`resfam:${fam}`);
    }
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

  // v0.15: per-character quest board rotation memory.
  // Keyed by (townId, tier) and reset when epoch changes.
  const seamKey = computeQuestBoardRotationSeamKey(ctx, roomId, tier);

  const rotationKey = `town:${townId}|t${tier}|${seamKey}`;
  const recentOffered = getRecentOfferedQuestIds(char as any, rotationKey, epoch);

  // v0.26: fairness weighting across rotations (quest shapes).
  const sigKey = `${rotationKey}|sigs`;
  const famKey = `${rotationKey}|families`;
  const recentSigs = getRecentOfferedStrings(char as any, sigKey, epoch);
  const recentFams = getRecentOfferedStrings(char as any, famKey, epoch);

  const followupRotationKey = `${rotationKey}|followupParents`;
  const recentFollowupParents = getRecentFollowupParentIds(char as any, followupRotationKey, epoch);

  const profileTags = getTownQuestBoardProfileTags(ctx, roomId);
  const profileName = pickTownQuestBoardProfile(profileTags);
  const tuningPresetTags = getTownQuestBoardTuningPresetTags(ctx, roomId);
  const tuningPreset = pickTownQuestBoardTuningPreset(tuningPresetTags);

  const quests = generateTownQuests({
    townId,
    tier,
    epoch,
    maxQuests: undefined,
    includeRepeatables: true,
    recentlyOfferedQuestIds: recentOffered,
    recentlyOfferedObjectiveSignatures: recentSigs,
    recentlyOfferedResourceFamilies: recentFams,
    tuning: getTownQuestBoardTuningOverrides(tier, profileName, tuningPreset),
  });

  // Back-compat: some contracts expect turned-in ("[T]") town quests to still appear on the board
  // even if the current generator no longer emits them for tier 1.
  // We only surface these when the character has explicit state for the quest, so we don't introduce
  // new "available" quests during early onboarding.
  try {
    const qs = ensureQuestState(char as any) as any;
    const safeTown = String(townId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    const legacyId = `town_${safeTown}_t${tier}_rat_tail_collection`;
    if (qs?.[legacyId]?.state === "turned_in" && !quests.some((q) => q.id === legacyId)) {
      quests.push({
        id: legacyId,
        name: "Rat Tail Collection",
        description: "A local alchemist is paying for rat tails for their experiments.",
        turninPolicy: "board",
        turninBoardId: townId,
        objectives: [{ kind: "collect_item", itemId: "rat_tail", required: 1 } as any],
        reward: { xp: 1 } as any,
        repeatable: true,
        maxCompletions: null,
      } as any);
    }
  } catch {
    // Non-fatal: board offering should never crash due to back-compat shims.
  }

  // Quest chains v0.3: surface unlocked follow-up quests on the board offering once prerequisites are met.
  const followups = computeUnlockedFollowupQuests(char as any);
  const followupsToSurface = selectFollowupsForBoard({ townId, tier, epoch }, quests, followups, char as any, recentFollowupParents);
  for (const q of followupsToSurface) {
    if (!quests.some((x) => x.id === q.id)) quests.push(q);
  }


  // v0.18: remember which follow-up parent chains we just surfaced (NEW only),
  // so the next refresh can spread "NEW follow-ups" across different parents over time.
  try {
    const st = ensureQuestState(char as any);
    const parentsByFollowup = computeUnlockedFollowupParents(char as any);
    const parentIds: string[] = [];

    for (const q of followupsToSurface) {
      if (!q?.id) continue;
      // Only rotate NEW follow-ups (unaccepted).
      if (st[q.id]) continue;

      const parents = parentsByFollowup.get(q.id) ?? [];
      if (!parents.length) continue;

      const parent = pickDeterministicParent({ townId, tier, epoch }, q.id, parents);
      if (!parent) continue;

      if (!parentIds.includes(parent)) parentIds.push(parent);
      if (parentIds.length >= 6) break;
    }

    recordQuestBoardFollowupParents(char as any, followupRotationKey, epoch, parentIds);
  } catch {
    // Non-fatal: parent rotation memory should never break the board.
  }

  // Persist rotation memory for the next board view. This is intentionally cheap and bounded.
  try {
    recordQuestBoardOffering(char as any, rotationKey, epoch, quests.map((q) => q.id));
    // v0.26: record quest shapes for future fairness weighting.
    const sigs: string[] = [];
    const fams: string[] = [];
    for (const q of quests) {
      if (!q?.id) continue;
      if (isRotationImmuneQuestId(q.id)) continue;
      sigs.push(objectiveSignatureOfQuest(q));
      fams.push(...semanticFamilyKeysOfQuest(q));
      if (sigs.length >= QUEST_BOARD_SHAPE_ROTATION_MAX) break;
    }
    recordQuestBoardStrings(char as any, sigKey, epoch, sigs);
    recordQuestBoardStrings(char as any, famKey, epoch, fams);
  } catch {
    // Non-fatal: rotation memory should never break the board.
  }

  return { townId, tier, epoch, quests };
}

// ----------------------------
// Quest chain density controls (v0.16)
// ----------------------------

type BoardKey = { townId: string; tier: number; epoch: string };

function selectFollowupsForBoard(
  key: BoardKey,
  offering: QuestDefinition[],
  unlocked: QuestDefinition[],
  char: CharacterState,
  recentFollowupParents: string[]
): QuestDefinition[] {
  if (!unlocked.length) return [];

  const state = ensureQuestState(char);
  const parentsByFollowup = computeUnlockedFollowupParents(char);

  // Always surface follow-ups that have already been accepted/completed/turned in.
  // (If we don't, they vanish from board filters that are offering-based.)
  const accepted: QuestDefinition[] = [];
  const unaccepted: QuestDefinition[] = [];

  for (const q of unlocked) {
    if (!q || !q.id) continue;
    if (offering.some((x) => x.id === q.id)) continue;

    if (state[q.id]) accepted.push(q);
    else unaccepted.push(q);
  }

  // Cap how many *NEW* follow-ups we surface at once.
  // Tier 1: 3, Tier 2: 4, Tier 3+: 4 (small but discoverable).
  const capNew = Math.max(1, 2 + Math.min(2, Math.floor(key.tier || 1)));

  const recentParentsSet = new Set((recentFollowupParents ?? []).map((x) => String(x ?? "")).filter(Boolean));


  // Deterministic selection that spreads NEW follow-ups across different parent chains first.
  // If a follow-up has multiple parents, we assign it to the earliest (deterministic) parent bucket.
  const buckets = new Map<string, QuestDefinition[]>();
  const orphan: QuestDefinition[] = [];

  for (const q of unaccepted) {
    const parents = parentsByFollowup.get(q.id) ?? [];
    const parent = parents.length ? pickDeterministicParent(key, q.id, parents) : null;
    if (!parent) {
      orphan.push(q);
      continue;
    }
    const arr = buckets.get(parent) ?? [];
    arr.push(q);
    buckets.set(parent, arr);
  }

  const parentKeys = [...buckets.keys()];
  parentKeys.sort((a, b) => {
    const ra = recentParentsSet.has(a) ? 1 : 0;
    const rb = recentParentsSet.has(b) ? 1 : 0;
    if (ra !== rb) return ra - rb;

    const ka = followupSortKey(key, a);
    const kb = followupSortKey(key, b);
    if (ka !== kb) return ka - kb;
    return a.localeCompare(b);
  });

  for (const p of parentKeys) {
    const arr = buckets.get(p) ?? [];
    arr.sort((a, b) => {
      const ka = followupSortKey(key, a.id);
      const kb = followupSortKey(key, b.id);
      if (ka !== kb) return ka - kb;
      return a.id.localeCompare(b.id);
    });
    buckets.set(p, arr);
  }

  orphan.sort((a, b) => {
    const ka = followupSortKey(key, a.id);
    const kb = followupSortKey(key, b.id);
    if (ka !== kb) return ka - kb;
    return a.id.localeCompare(b.id);
  });

  // Quest chains v0.19: anti "repeat parent spam" within a single refresh.
  //
  // Selection policy for NEW follow-ups:
  // 1) First pass: pick at most ONE quest from each parent bucket (in parent order).
  // 2) Then fill remaining slots deterministically, but prefer:
  //    - orphan follow-ups (no known parent) first
  //    - then additional quests from parent buckets
  //    and avoid taking more than 2 from the same parent unless we must (scarcity).
  const picked: QuestDefinition[] = [];
  const pickedByParent = new Map<string, number>();

  // First pass: one per parent.
  for (const p of parentKeys) {
    if (picked.length >= capNew) break;
    const arr = buckets.get(p);
    if (!arr || arr.length === 0) continue;
    picked.push(arr.shift()!);
    pickedByParent.set(p, 1);
  }

  // Second pass: fill slack.
  if (picked.length < capNew) {
    // Flatten remaining bucket items with parent tagging.
    type Tagged = { parent: string | null; q: QuestDefinition };
    const tagged: Tagged[] = [];

    // Orphans first (they increase variety and avoid parent spam).
    for (const q of orphan) tagged.push({ parent: null, q });

    for (const p of parentKeys) {
      const arr = buckets.get(p);
      if (!arr || arr.length === 0) continue;
      for (const q of arr) tagged.push({ parent: p, q });
    }

    // Deterministic ordering for the fill pool.
    tagged.sort((a, b) => {
      const ka = followupSortKey(key, a.q.id);
      const kb = followupSortKey(key, b.q.id);
      if (ka !== kb) return ka - kb;
      return a.q.id.localeCompare(b.q.id);
    });

    // Prefer not to exceed 2 per parent, but relax if scarcity would underfill.
    const MAX_PER_PARENT_SOFT = 2;

    // First fill pass respecting soft max.
    for (const t of tagged) {
      if (picked.length >= capNew) break;
      if (!t.parent) {
        picked.push(t.q);
        continue;
      }
      const cur = pickedByParent.get(t.parent) ?? 0;
      if (cur >= MAX_PER_PARENT_SOFT) continue;
      picked.push(t.q);
      pickedByParent.set(t.parent, cur + 1);
    }

    // Relaxation pass: if still under cap, take whatever remains deterministically.
    if (picked.length < capNew) {
      for (const t of tagged) {
        if (picked.length >= capNew) break;
        // Skip already picked quest ids
        if (picked.some((x) => x.id === t.q.id)) continue;
        picked.push(t.q);
      }
    }
  }

  return accepted.concat(picked);
}

function pickDeterministicParent(key: BoardKey, followupId: string, parents: string[]): string {
  // Parents are already sorted lexicographically. We additionally stabilize by hash so epoch changes
  // can reshuffle without becoming random.
  let best = parents[0] ?? "";
  let bestKey = followupSortKey(key, `${followupId}|parent|${best}`);
  for (let i = 1; i < parents.length; i++) {
    const p = parents[i];
    const k = followupSortKey(key, `${followupId}|parent|${p}`);
    if (k < bestKey) {
      best = p;
      bestKey = k;
    }
  }
  return best;
}

function followupSortKey(key: BoardKey, questId: string): number {
  const h = hashString32(`followup|${key.townId}|t${key.tier}|${key.epoch}|${questId}`);
  return h >>> 0;
}

function hashString32(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0) || 1;
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