// worldcore/mud/commands/gathering/skinningCommand.ts

import type { Entity } from "../../../shared/Entity";

import { isDeadEntity } from "../../../combat/entityCombat";
import { getSkinLootService } from "../../../combat/SkinLootService";
import { deliverItemToBagsOrMail } from "../../../loot/OverflowDelivery";
import { getNpcPrototype } from "../../../npc/NpcTypes";

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

function getRoomId(ctx: any, char: any): string | null {
  const rid = (char?.roomId ?? char?.room ?? char?.location?.roomId) as string | undefined;
  if (rid && typeof rid === "string") return rid;
  const fallback = ctx?.world?.getRoomId?.(char);
  return typeof fallback === "string" && fallback ? fallback : null;
}

function getRoomEntities(ctx: any, roomId: string): Entity[] {
  const arr = (ctx?.entities?.getEntitiesInRoom?.(roomId) ??
    ctx?.entities?.getRoomEntities?.(roomId) ??
    []) as Entity[];
  return Array.isArray(arr) ? arr : [];
}

function parseTargetToken(input: string): string | null {
  const t = norm(input).trim();
  if (!t) return null;
  // allow: "skin rat" or "skin rat.1" (caller already stripped command)
  const pieces = t.split(/\s+/g).filter(Boolean);
  return pieces[0] ?? null;
}

function findTargetByToken(entities: Entity[], token: string): Entity | null {
  const t = token.toLowerCase();

  // Prefer explicit handle match (rat.1).
  for (const e of entities) {
    const h = norm((e as any).handle).toLowerCase();
    if (h && h === t) return e;
  }

  // Then try name prefix ("rat").
  for (const e of entities) {
    const name = norm((e as any).name).toLowerCase();
    if (name && name.startsWith(t)) return e;
  }

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

  const roomId = getRoomId(ctx, char);
  if (!roomId) return "[skinning] You are nowhere.";

  const entities = getRoomEntities(ctx, roomId);
  const token = parseTargetToken(input);
  if (!token) return "[skinning] Usage: skin <target>";

  const target = findTargetByToken(entities, token);
  if (!target) return `[skinning] There is no '${token}' here to skin.`;

  if (target.type !== "npc" && target.type !== "corpse") {
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

  const proto = getNpcPrototype(protoId);
  if (!proto) return `[skinning] Unknown NPC prototype '${protoId}'.`;

  const rand = randFn(ctx);

  // Determine drops: DB-driven profile if available, else fallback.
  const drops: Array<{ itemId: string; qty: number }> = [];

  try {
    const svc = getSkinLootService();
    const tags = Array.isArray((proto as any).tags) ? (proto as any).tags : [];
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
