// worldcore/rewards/RewardDelivery.ts
//
// Central helper for “never drop rewards”.
// Policy:
//  1) Always attempt bags first.
//  2) If overflow and mail exists -> mail overflow.
//  3) If mail missing OR mail fails -> queue overflow in progression.pendingRewards.
//  4) Provide claim logic to retry queued entries later.

import type { CharacterState, InventoryState, PendingRewardEntry, PendingRewardItem } from "../characters/CharacterTypes";
import { ensureProgression } from "../progression/ProgressionCore";
import { addItemToBags } from "../items/InventoryHelpers";
import { getItemTemplate } from "../items/ItemCatalog";
import { resolveItem } from "../items/resolveItem";

type OwnerKind = "account" | "character" | "guild";

export type RewardDeliveryContext = {
  items?: any;
  mail?: {
    sendSystemMail(
      ownerId: string,
      ownerKind: OwnerKind,
      subject: string,
      body: string,
      attachments: { itemId: string; qty: number; meta?: any }[]
    ): Promise<void>;
  };
  session?: { identity?: { userId: string } };
};

export type RewardItemInput = {
  itemId: string;
  qty: number;
  meta?: any;
};

export type DeliverRewardsOptions = {
  source: string;
  note?: string;

  // Mail routing
  ownerId?: string;      // default: ctx.session.identity.userId
  ownerKind?: OwnerKind; // default: "account"

  // Mail copy
  mailSubject?: string;
  mailBody?: string;
};

export type DeliverRewardsResult = {
  deliveredToBags: { itemId: string; qty: number }[];
  mailed: { itemId: string; qty: number }[];
  queued: { itemId: string; qty: number }[];
};

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function clampQty(qty: number): number {
  const n = Math.floor(Number(qty));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function clampStack(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function defaultMailBody(source: string): string {
  const src = s(source) || "a reward";
  return `Your bags were full while receiving ${src}.\nExtra items were delivered to your mailbox.`;
}

function makePendingId(): string {
  return `pr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveNameAndStack(
  ctx: RewardDeliveryContext,
  itemId: string
): { name: string; maxStack: number } {
  // Prefer DB-backed resolveItem if ctx.items exists.
  try {
    if (ctx.items) {
      const tpl: any = resolveItem(ctx.items, itemId);
      if (tpl) {
        return {
          name: s(tpl.name) || tpl.id || itemId,
          maxStack: clampStack(tpl.maxStack),
        };
      }
    }
  } catch {
    // best-effort, fall through
  }

  // Fallback to static catalog.
  const cat = getItemTemplate(itemId) as any;
  if (cat) {
    return {
      name: s(cat.name) || cat.id || itemId,
      maxStack: clampStack(cat.maxStack),
    };
  }

  return { name: itemId, maxStack: 1 };
}

export function enqueuePendingReward(
  char: CharacterState,
  source: string,
  items: PendingRewardItem[],
  note?: string
): PendingRewardEntry | null {
  const cleaned = (items ?? [])
    .map((it) => ({
      itemId: s(it.itemId),
      qty: clampQty(it.qty),
      meta: it.meta,
    }))
    .filter((it) => it.itemId && it.qty > 0);

  if (cleaned.length === 0) return null;

  const prog = ensureProgression(char);
  const entry: PendingRewardEntry = {
    id: makePendingId(),
    createdAt: Date.now(),
    source: s(source) || "rewards",
    note: s(note) || undefined,
    items: cleaned,
  };

  prog.pendingRewards ??= [];
  prog.pendingRewards.push(entry);
  return entry;
}

/**
 * Preflight for “no mail” situations:
 * If mail is missing and the items would overflow bags, return ok=false.
 * (Used for quest turn-in before consuming collect items.)
 */
export function preflightBagsForRewards(
  ctx: RewardDeliveryContext,
  inventory: InventoryState,
  items: RewardItemInput[]
): { ok: boolean; missingSlotsFor?: { itemId: string; qty: number }[] } {
  if (ctx.mail) return { ok: true };

  const sim: InventoryState = JSON.parse(JSON.stringify(inventory ?? {}));
  const missing: { itemId: string; qty: number }[] = [];

  for (const it of items ?? []) {
    const itemId = s(it.itemId);
    const qty = clampQty(it.qty);
    if (!itemId || qty <= 0) continue;

    const { maxStack } = resolveNameAndStack(ctx, itemId);
    const leftover = addItemToBags(sim, itemId, qty, maxStack);
    if (leftover > 0) {
      missing.push({ itemId, qty: leftover });
    }
  }

  return missing.length ? { ok: false, missingSlotsFor: missing } : { ok: true };
}

/**
 * Deliver reward items using “never drop” rules.
 * - Bags first
 * - If overflow and mail exists -> attempt mail
 * - If mail missing/fails -> queue overflow
 */
export async function deliverRewardItemsNeverDrop(
  ctx: RewardDeliveryContext,
  char: CharacterState,
  inventory: InventoryState,
  items: RewardItemInput[],
  opts: DeliverRewardsOptions
): Promise<DeliverRewardsResult> {
  const deliveredToBags: { itemId: string; qty: number }[] = [];
  const mailed: { itemId: string; qty: number }[] = [];
  const queued: { itemId: string; qty: number }[] = [];

  const toQueue: PendingRewardItem[] = [];

  for (const it of items ?? []) {
    const itemId = s(it.itemId);
    const qty = clampQty(it.qty);
    if (!itemId || qty <= 0) continue;

    const { maxStack } = resolveNameAndStack(ctx, itemId);

    // 1) Bags first
    const leftover = addItemToBags(inventory, itemId, qty, maxStack);
    const added = Math.max(0, qty - leftover);

    if (added > 0) deliveredToBags.push({ itemId, qty: added });

    // 2) Overflow handling
    if (leftover > 0) {
      // If we can mail, try to mail overflow.
      if (ctx.mail) {
        const ownerId = opts.ownerId ?? ctx.session?.identity?.userId;
        const ownerKind: OwnerKind = (opts.ownerKind ?? "account") as OwnerKind;

        if (ownerId) {
          try {
            const subject = s(opts.mailSubject) || "Overflow delivery";
            const body = s(opts.mailBody) || defaultMailBody(opts.source);

            await ctx.mail.sendSystemMail(ownerId, ownerKind, subject, body, [
              { itemId, qty: leftover, meta: it.meta },
            ]);

            mailed.push({ itemId, qty: leftover });
            continue;
          } catch {
            // Mail failed -> queue overflow
          }
        }
      }

      // No mail OR mail failed -> queue overflow
      toQueue.push({ itemId, qty: leftover, meta: it.meta });
      queued.push({ itemId, qty: leftover });
    }
  }

  if (toQueue.length > 0) {
    enqueuePendingReward(char, opts.source, toQueue, opts.note);
  }

  return { deliveredToBags, mailed, queued };
}

/**
 * Claim pending rewards (FIFO).
 * Stops early if some items cannot be delivered (they remain queued).
 */
export async function claimPendingRewards(
  ctx: RewardDeliveryContext,
  char: CharacterState,
  inventory: InventoryState,
  maxEntries: number = 9999
): Promise<{
  claimedEntries: number;
  claimedItems: { itemId: string; qty: number }[];
  mailedItems: { itemId: string; qty: number }[];
  stillQueued: number;
}> {
  const prog = ensureProgression(char);
  const q = (prog.pendingRewards ??= []);
  if (q.length === 0) {
    return { claimedEntries: 0, claimedItems: [], mailedItems: [], stillQueued: 0 };
  }

  const claimedItems: { itemId: string; qty: number }[] = [];
  const mailedItems: { itemId: string; qty: number }[] = [];

  let claimedEntries = 0;

  // Process FIFO, but stop if we can’t fully process an entry (keeps semantics sane)
  const keep: PendingRewardEntry[] = [];

  for (let i = 0; i < q.length; i++) {
    const entry = q[i];
    if (claimedEntries >= maxEntries) {
      keep.push(entry);
      continue;
    }

    // Try delivering this entry’s items
    const res = await deliverRewardItemsNeverDrop(
      ctx,
      char,
      inventory,
      entry.items.map((it) => ({ itemId: it.itemId, qty: it.qty, meta: it.meta })),
      {
        source: `reward claim: ${entry.source}`,
        note: entry.note,
        mailSubject: "Reward delivery",
        mailBody: defaultMailBody("queued rewards"),
      }
    );

    // If any items got re-queued, we treat this entry as NOT fully claimed and stop.
    if (res.queued.length > 0) {
      // keep original entry + any later entries
      keep.push(entry);
      for (let j = i + 1; j < q.length; j++) keep.push(q[j]);
      break;
    }

    claimedEntries += 1;
    claimedItems.push(...res.deliveredToBags);
    mailedItems.push(...res.mailed);
  }

  prog.pendingRewards = keep;

  return {
    claimedEntries,
    claimedItems,
    mailedItems,
    stillQueued: keep.length,
  };
}
