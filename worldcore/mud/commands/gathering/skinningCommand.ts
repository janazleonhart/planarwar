// worldcore/mud/commands/gathering/skinningCommand.ts

import type { Entity } from "../../../shared/Entity";

import { isDeadEntity } from "../../../combat/entityCombat";
import { getSkinLootService } from "../../../combat/SkinLootService";
import { deliverItemToBagsOrMail } from "../../../loot/OverflowDelivery";

import { getItemTemplate } from "../../../items/ItemCatalog";
import { resolveItem } from "../../../items/resolveItem";

import { applyFallbackSkinLoot } from "../../actions/MudWorldActions";
import { applyProgressionForEvent } from "../../MudProgressionHooks";
import { applyProgressionEvent } from "../../../progression/ProgressionCore";

function norm(s: string): string {
  return (s ?? "").trim();
}

function rollInt(min: number, max: number, rand: () => number): number {
  const lo = Math.floor(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= 0) return 0;
  if (lo === hi) return Math.max(0, lo);
  const r = rand();
  const t = Math.max(0, Math.min(0.999999, Number.isFinite(r) ? r : 0));
  return Math.max(0, lo + Math.floor(t * (hi - lo + 1)));
}

function randFn(ctx: any): () => number {
  // Prefer deterministic RNG if the server provides one.
  const r = ctx?.rng ?? ctx?.random;
  if (typeof r?.next === "function") return () => Number(r.next());
  if (typeof r?.float === "function") return () => Number(r.float());
  if (typeof r === "function") return () => Number(r());
  return () => Math.random();
}

function getPlayerEntity(ctx: any): Entity | null {
  const sessionId = ctx?.session?.id as string | undefined;
  if (!sessionId) return null;
  if (ctx?.entities?.getEntityByOwner) {
    const ent = ctx.entities.getEntityByOwner(sessionId) as any;
    return ent ?? null;
  }
  return null;
}

function getRoomId(ctx: any, char: any): string | null {
  // Primary: derive room from the player's world entity (authoritative in live server).
  const player = getPlayerEntity(ctx) as any;
  const rid = player?.roomId;
  if (typeof rid === "string" && rid) return rid;

  // Secondary: some test harnesses may hang roomId off the character directly.
  const direct = (char?.roomId ?? char?.room ?? char?.location?.roomId) as any;
  if (typeof direct === "string" && direct) return direct;

  // Tertiary: older context surface.
  const fallback = ctx?.world?.getRoomId?.(char);
  return typeof fallback === "string" && fallback ? fallback : null;
}

function getRoomEntities(ctx: any, roomId: string): Entity[] {
  const arr = (ctx?.entities?.getEntitiesInRoom?.(roomId) ??
    ctx?.entities?.getRoomEntities?.(roomId) ??
    []) as Entity[];
  return Array.isArray(arr) ? arr : [];
}

function entityDist2(a: any, b: any): number {
  const ax = typeof a?.x === "number" ? a.x : 0;
  const az = typeof a?.z === "number" ? a.z : 0;
  const bx = typeof b?.x === "number" ? b.x : 0;
  const bz = typeof b?.z === "number" ? b.z : 0;
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function sortByDistance(entities: Entity[], player: Entity | null): Entity[] {
  if (!player) return [...entities];
  return [...entities].sort((l: any, r: any) => entityDist2(l, player) - entityDist2(r, player));
}

function baseHandleFromName(name: string): string {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return "";
  const parts = n.split(/[^a-z0-9]+/g).filter(Boolean);
  if (!parts.length) return "";
  return parts[parts.length - 1] ?? "";
}

function baseHandleFromEntity(e: Entity): string {
  const fromName = baseHandleFromName((e as any).name ?? "");
  if (fromName) return fromName;
  const protoId = norm(String((e as any).protoId ?? ""));
  if (protoId) {
    const tail = protoId.split(/[._]/g).filter(Boolean).pop();
    if (tail) return tail.toLowerCase();
  }
  return String((e as any).type ?? "").toLowerCase();
}

function parseNumericSelection(token: string): number | null {
  if (!/^\d+$/.test(token)) return null;
  const idx = Number(token) - 1;
  if (!Number.isFinite(idx) || idx < 0) return null;
  return idx;
}

function parseHandleToken(token: string): { base: string; idx?: number } | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  const m = /^([a-z0-9_]+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const base = m[1] ?? "";
  const idxStr = m[2];
  if (!base) return null;
  if (idxStr) {
    const idx = Number(idxStr);
    if (!Number.isFinite(idx) || idx <= 0) return null;
    return { base, idx };
  }
  return { base };
}

function isSkinnableCorpse(e: Entity): boolean {
  return (e as any).type === "npc" && isDeadEntity(e);
}

function findTargetByToken(entities: Entity[], tokenRaw: string, player: Entity | null): Entity | null {
  const token = tokenRaw.trim();
  if (!token) return null;

  const ordered = sortByDistance(entities, player);

  // Numeric selection: match the nearby index ordering (distance-sorted).
  const nSel = parseNumericSelection(token);
  if (nSel !== null) return ordered[nSel] ?? null;

  const preferDead = (xs: Entity[]) => xs.find((e) => isDeadEntity(e)) ?? xs[0] ?? null;

  // Handle-style token: rat.1, guard.2, patch.3, etc.
  const h = parseHandleToken(token);
  if (h) {
    const base = h.base;

    // For skinning, ALWAYS prefer dead entities first (this also fixes the duplicate handle bug
    // where living rat.1 and corpse rat.1 can coexist).
    const dead = ordered.filter((e) => isSkinnableCorpse(e) && baseHandleFromEntity(e) === base);
    if (dead.length) {
      if (h.idx) return dead[h.idx - 1] ?? dead[0] ?? null;
      return dead[0] ?? null;
    }

    const any = ordered.filter((e) => baseHandleFromEntity(e) === base);
    if (any.length) {
      if (h.idx) return any[h.idx - 1] ?? preferDead(any);
      return preferDead(any);
    }
  }

  // Proto-id exact match (e.g. town_rat).
  const tLower = token.toLowerCase();
  const protoMatches = ordered.filter((e: any) => typeof e?.protoId === "string" && e.protoId.toLowerCase() === tLower);
  if (protoMatches.length) return preferDead(protoMatches);

  // Name prefix match (prefer dead).
  const nameMatches = ordered.filter((e) => ((e as any).name ?? "").toLowerCase().startsWith(tLower));
  if (nameMatches.length) return preferDead(nameMatches);

  return null;
}

function describeItemLine(itemId: string, qty: number, mailedQty: number, ctx: any): string {
  // Prefer resolved name.
  let name = itemId;
  try {
    if (ctx?.items) {
      const tpl: any = resolveItem(ctx.items, itemId);
      if (tpl?.name) name = String(tpl.name);
    }
  } catch {
    // ignore
  }

  if (name === itemId) {
    const cat: any = getItemTemplate(itemId);
    if (cat?.name) name = String(cat.name);
  }

  const shownQty = Math.max(0, qty);
  const prefix = shownQty === 1 ? "" : `${shownQty}x `;
  let line = `${prefix}${name}`;
  if (mailedQty > 0) line += " (via mail)";
  return line;
}

export async function skinningCommand(ctx: any, input: string): Promise<string> {
  const char = ctx?.session?.character;
  if (!char) return "[skinning] No character loaded.";

  const player = getPlayerEntity(ctx);
  const roomId = getRoomId(ctx, char);
  if (!roomId) return "[skinning] You are nowhere.";

  const entities = getRoomEntities(ctx, roomId);
  const token = norm(input);
  if (!token) return "[skinning] Usage: skin <target>";

  const target = findTargetByToken(entities, token, player);
  if (!target) return `[skinning] There is no '${token}' here to skin.`;

  if ((target as any).type !== "npc") {
    return "[skinning] You can only skin corpses.";
  }

  if (!isDeadEntity(target)) {
    return "[skinning] That creature is still alive.";
  }

  const anyTarget: any = target as any;
  if (anyTarget.skinned) {
    return "[skinning] That corpse has already been skinned.";
  }

  const protoId = norm(anyTarget.protoId);
  if (!protoId) {
    return "[skinning] That corpse has no prototype id; cannot skin.";
  }

  const rand = randFn(ctx);

  // Determine drops: DB-driven profile if available, else fallback.
  const drops: Array<{ itemId: string; qty: number }> = [];

  try {
    const svc = getSkinLootService();
    const tags = Array.isArray(anyTarget.tags) ? anyTarget.tags : [];
    const entries = await svc.getEntries(protoId, tags);

    for (const e of entries) {
      const chance = typeof e.chance === "number" ? e.chance : 1;
      const roll = rand();
      if (roll > chance) continue;

      const qty = rollInt(e.minQty, e.maxQty, rand);
      if (qty <= 0) continue;
      drops.push({ itemId: e.itemId, qty });
    }
  } catch {
    // ignore; we'll fall back below
  }

  if (drops.length === 0) {
    const fb = applyFallbackSkinLoot(protoId);
    if (fb) {
      const qty = rollInt(fb.minQty, fb.maxQty, rand);
      if (qty > 0) drops.push({ itemId: fb.itemId, qty });
    }
  }

  // Mark skinned immediately (prevents double-skin even if delivery fails).
  anyTarget.skinned = true;

  const lootLines: string[] = [];

  // Deliver loot to bags; overflow goes to mailbox when possible.
  if (drops.length > 0) {
    for (const d of drops) {
      const r = await deliverItemToBagsOrMail(
        { items: ctx.items, mail: ctx.mail, session: ctx.session },
        {
          inventory: char.inventory,
          itemId: d.itemId,
          qty: d.qty,
          sourceVerb: "skinning",
          sourceName: norm((target as any).name) || "your target",
          mailSubject: "Overflow delivery",
          mailBody: `Your bags were full while skinning ${(target as any).name ?? "a corpse"}.`,
        }
      );

      if (r.added > 0) {
        lootLines.push(describeItemLine(r.itemId, r.added, 0, ctx));
      }
      if (r.mailed > 0) {
        lootLines.push(describeItemLine(r.itemId, r.mailed, r.mailed, ctx));
      }
    }
  }

  // Progression hooks (quests/titles/etc).
  // 1) Internal progression tracker.
  try {
    applyProgressionEvent(char, {
      kind: "harvest",
      nodeProtoId: protoId,
      gatheringKind: "skinning",
      amount: 1,
    });
  } catch {
    // best-effort
  }

  // 2) MUD-side tasks/quests/titles hook.
  let progressionSnippets: string[] = [];
  try {
    // Keep category aligned with the rest of the gathering pipeline.
    // (MudWorldActions uses "harvests"; ProgressionCategory currently does not include "skins".)
    const res = await applyProgressionForEvent(ctx, char, "harvests", protoId);
    progressionSnippets = Array.isArray(res?.snippets) ? res.snippets : [];
  } catch {
    // best-effort
  }

  // Persist character changes.
  ctx.session.character = char;
  if (ctx.characters) {
    try {
      await ctx.characters.saveCharacter(char);
    } catch {
      // best-effort
    }
  }

  if (lootLines.length === 0) {
    return "[skinning] You find nothing worth harvesting.";
  }

  let line = `[skinning] You harvest ${lootLines.join(", ")}.`;
  if (progressionSnippets.length > 0) line += " " + progressionSnippets.join(" ");
  return line;
}

// Compatibility export: mud/commands/registry.ts (and older code) expects handleSkinningCommand.
// Keep the slimmer skinningCommand(ctx, "target") as the core implementation.
export async function handleSkinningCommand(
  ctx: any,
  char: any,
  input: { cmd: string; args: string[]; parts: string[]; world?: any }
): Promise<string> {
  const c: any = ctx ?? {};
  c.session = c.session ?? {};
  if (!c.session.character) c.session.character = char;

  const target = Array.isArray(input?.args) ? input.args.join(" ") : "";
  return skinningCommand(c, target);
}
