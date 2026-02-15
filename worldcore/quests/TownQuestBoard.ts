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

// ----------------------------
// Public API
// ----------------------------

export function renderTownQuestBoard(ctx: any, char: CharacterState): string {
  const offering = getTownQuestOffering(ctx, char);
  if (!offering) return "[quest] You are nowhere. (No room/town context found.)";

  const state = ensureQuestState(char);
  const lines: string[] = [];

  lines.push(
    `Quest Board: town=${offering.townId} tier=${offering.tier} epoch=${offering.epoch}`
  );

  if (offering.quests.length === 0) {
    lines.push(" - No quests available.");
    return lines.join("\n");
  }

  offering.quests.forEach((q, i) => {
    const entry = state[q.id];
    const status =
      !entry
        ? "[ ]"
        : entry.state === "active"
        ? "[A]"
        : entry.state === "completed"
        ? "[C]"
        : "[T]";

    const obj = q.objectives?.[0];
    const objText = obj ? summarizeObjective(obj as any) : "Objective: (none)";
    const rewardText = summarizeRewards(q);

    lines.push(` ${String(i + 1).padStart(2, " ")}. ${status} ${q.name} (${q.id})`);
    lines.push(`     - ${objText}`);
    if (rewardText) lines.push(`     - Rewards: ${rewardText}`);
  });

  lines.push("");
  lines.push("Use: quest accept <#|id>   |   quest abandon <#|id>   |   questlog");

  return lines.join("\n").trimEnd();
}

export async function acceptTownQuest(
  ctx: any,
  char: CharacterState,
  idOrIndexRaw: string
): Promise<string> {
  const offering = getTownQuestOffering(ctx, char);
  if (!offering) return "[quest] Cannot accept: no town context.";

  const query = String(idOrIndexRaw ?? "").trim();
  if (!query) return "Usage: quest accept <#|id|name>";

  // Resolution order:
  // 1) Current town offering
  // 2) Static QuestRegistry
  // 3) Backing QuestService (ex: PostgresQuestService) via ctx.quests

  // 1) Offering exact (index/id/name)
  const fromOfferingExact = resolveFromOffering(offering.quests, query);
  if (fromOfferingExact) return await acceptResolvedQuest(ctx, char, fromOfferingExact, {
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
    return renderAmbiguousQuestMatches("[quest] Ambiguous. Did you mean:", offeringFuzzy);
  }

  // 2) Registry exact
  const fromRegistryExact = resolveRegistryQuest(query);
  if (fromRegistryExact) return await acceptResolvedQuest(ctx, char, fromRegistryExact, { kind: "registry" });

  // 2b) Registry fuzzy
  const registryFuzzy = resolveRegistryQuestFuzzy(query);
  if (registryFuzzy.length === 1) {
    return await acceptResolvedQuest(ctx, char, registryFuzzy[0], { kind: "registry" });
  }
  if (registryFuzzy.length > 1) {
    return renderAmbiguousQuestMatches("[quest] Ambiguous. Did you mean:", registryFuzzy);
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
    return renderAmbiguousQuestMatches("[quest] Ambiguous. Did you mean:", serviceFuzzy.matches);
  }

  // Unknown: show suggestions from offering+registry (cheap, deterministic)
  const suggestions = [...resolveFromOfferingFuzzy(offering.quests, query), ...resolveRegistryQuestFuzzy(query)].slice(0, 8);
  if (suggestions.length > 0) {
    return [
      `[quest] Unknown quest '${query}'.`,
      renderAmbiguousQuestMatches("Did you mean:", suggestions),
      "(Use 'quest board' to list current town quests.)",
    ].join("");
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

function renderAmbiguousQuestMatches(header: string, matches: QuestDefinition[]): string {
  const lines: string[] = [];
  lines.push(header);
  matches.slice(0, 8).forEach((q) => lines.push(` - ${q.name} (${q.id})`));
  if (matches.length > 8) lines.push(` - ...and ${matches.length - 8} more`);
  return lines.join("");
}

export async function abandonQuest(
  ctx: any,
  char: CharacterState,
  idOrIndexRaw: string
): Promise<string> {
  const idOrIndex = String(idOrIndexRaw ?? "").trim();
  if (!idOrIndex) return "Usage: quest abandon <#|id>";

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

  // If they gave a number, interpret it against the current board.
  const offering = getTownQuestOffering(ctx, char);
  if (offering) {
    const q = resolveFromOffering(offering.quests, idOrIndex);
    if (q && state[q.id]) {
      delete state[q.id];
      await persistQuestState(ctx, char);
      return `[quest] Abandoned: '${q.name}'.`;
    }
  }

  return `[quest] You don't have '${idOrIndex}' accepted.`;
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
      return `Talk to ${obj.npcId} (${obj.required ?? 1}x)`;
    default:
      return `Objective: ${String(obj.kind ?? "unknown")}`;
  }
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
