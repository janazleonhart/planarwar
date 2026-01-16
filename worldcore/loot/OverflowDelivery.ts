// worldcore/loot/OverflowDelivery.ts
//
// Centralized overflow-by-mail delivery helper.
//
// Policy:
//  1) Try to add items to bag inventory.
//  2) If bags overflow and MailService is available -> send overflow as system mail.
//  3) If mail is unavailable or fails -> overflow is dropped (v1 behavior).
//
// This module is intentionally dependency-light so both combat and MUD commands
// can use it without duplicating overflow policy logic.

import type { InventoryState } from "../characters/CharacterTypes";
import type { MailService } from "../mail/MailService";
import { addItemToBags } from "../items/InventoryHelpers";
import { getItemTemplate } from "../items/ItemCatalog";
import { resolveItem } from "../items/resolveItem";

type OwnerKind = Parameters<MailService["sendSystemMail"]>[1];

export type OverflowDeliveryContext = {
  // Optional; used to resolve DB-backed item templates (via resolveItem).
  items?: any;

  // Optional; used to mail overflow.
  mail?: MailService;

  // Optional; convenience default ownerId source.
  session?: { identity?: { userId: string } };
};

export type DeliverItemOptions = {
  inventory: InventoryState;
  itemId: string;
  qty: number;

  // Optional overrides if the caller already resolved the item.
  displayName?: string;
  maxStack?: number;

  // Mail routing.
  ownerId?: string; // default: ctx.session.identity.userId (if present)
  ownerKind?: OwnerKind; // default: "account"

  // Mail copy.
  sourceVerb?: string; // e.g. "looting", "skinning", "mining"
  sourceName?: string; // e.g. "Town Rat", "Hematite Iron Vein"
  mailSubject?: string; // default: "Overflow delivery"
  mailBody?: string; // default: derived from verb + sourceName
};

export type DeliverItemResult = {
  itemId: string;
  name: string;
  requested: number;
  added: number;
  mailed: number;

  // Items that could not be delivered (bags full and mail unavailable/failed).
  // This is the "true" leftover after all policy attempts.
  leftover: number;

  // Backwards-compat name used by earlier iterations of this helper.
  overflowDropped: number;
};

export type DeliverItemsOptions = Omit<
  DeliverItemOptions,
  "itemId" | "qty" | "displayName" | "maxStack"
> & {
  items: Array<{
    itemId: string;
    qty: number;
    displayName?: string;
    maxStack?: number;

    // Optional per-item sourceName override (useful if a bundle includes mixed sources).
    sourceName?: string;
  }>;
};

export type DeliverItemsResult = {
  results: DeliverItemResult[];
  totalAdded: number;
  totalMailed: number;
  totalDropped: number;
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

function defaultMailBody(verb: string, sourceName: string): string {
  const v = s(verb) || "looting";
  const src = s(sourceName) || "your target";
  return `Your bags were full while ${v} ${src}.\nExtra items were delivered to your mailbox.`;
}

function resolveNameAndStack(
  ctx: OverflowDeliveryContext,
  itemId: string,
  displayName?: string,
  maxStack?: number
): { name: string; maxStack: number } {
  // Caller overrides win.
  if (displayName || maxStack) {
    return {
      name: s(displayName) || itemId,
      maxStack: clampStack(maxStack),
    };
  }

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

  // Unknown item: still allow delivery attempt with stack=1, name=itemId.
  return { name: itemId, maxStack: 1 };
}

/**
 * Deliver ONE item stack bundle into bags; if overflow occurs, attempt to mail overflow.
 */
export async function deliverItemToBagsOrMail(
  ctx: OverflowDeliveryContext,
  opts: DeliverItemOptions
): Promise<DeliverItemResult> {
  const requested = clampQty(opts.qty);
  const itemId = s(opts.itemId);

  if (!itemId || requested <= 0) {
    return {
      itemId: itemId || opts.itemId,
      name: itemId || opts.itemId,
      requested,
      added: 0,
      mailed: 0,
      leftover: 0,
      overflowDropped: 0,
    };
  }

  const { name, maxStack } = resolveNameAndStack(
    ctx,
    itemId,
    opts.displayName,
    opts.maxStack
  );

  // 1) Bags first.
  const preMailLeftover = addItemToBags(opts.inventory, itemId, requested, maxStack);
  const added = Math.max(0, requested - preMailLeftover);

  // 2) Attempt mail overflow.
  const overflow = Math.max(0, preMailLeftover);
  let mailed = 0;
  let dropped = 0;

  if (overflow > 0 && ctx.mail) {
    const ownerId = opts.ownerId ?? ctx.session?.identity?.userId;
    const ownerKind = (opts.ownerKind ?? "account") as OwnerKind;

    if (ownerId) {
      try {
        const subject = s(opts.mailSubject) || "Overflow delivery";
        const body =
          s(opts.mailBody) ||
          defaultMailBody(opts.sourceVerb ?? "looting", opts.sourceName ?? "your target");

        await ctx.mail.sendSystemMail(ownerId, ownerKind, subject, body, [
          { itemId, qty: overflow },
        ]);

        mailed = overflow;
      } catch {
        // Mail failed: keep v1 behavior (drop overflow).
        dropped = overflow;
      }
    } else {
      // No owner to mail to: drop overflow.
      dropped = overflow;
    }
  } else {
    // No mail service: drop overflow (v1).
    dropped = overflow;
  }

  return {
    itemId,
    name,
    requested,
    added,
    mailed,
    leftover: dropped,
    overflowDropped: dropped,
  };
}

/**
 * Deliver MANY items via the same policy. Convenience wrapper.
 */
export async function deliverItemsToBagsOrMail(
  ctx: OverflowDeliveryContext,
  opts: DeliverItemsOptions
): Promise<DeliverItemsResult> {
  const results: DeliverItemResult[] = [];

  let totalAdded = 0;
  let totalMailed = 0;
  let totalDropped = 0;

  for (const it of opts.items ?? []) {
    const r = await deliverItemToBagsOrMail(ctx, {
      inventory: opts.inventory,
      itemId: it.itemId,
      qty: it.qty,
      displayName: it.displayName,
      maxStack: it.maxStack,

      ownerId: opts.ownerId,
      ownerKind: opts.ownerKind,

      sourceVerb: opts.sourceVerb,
      sourceName: it.sourceName ?? opts.sourceName,

      mailSubject: opts.mailSubject,
      mailBody: opts.mailBody,
    });

    results.push(r);
    totalAdded += r.added;
    totalMailed += r.mailed;
    totalDropped += r.overflowDropped;
  }

  return { results, totalAdded, totalMailed, totalDropped };
}
