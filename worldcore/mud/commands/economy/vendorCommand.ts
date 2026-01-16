// worldcore/mud/commands/economy/vendorCommand.ts

import { getCharacterGold, setCharacterGold } from "../../../economy/EconomyHelpers";
import { deliverItemToBagsOrMail } from "../../../loot/OverflowDelivery";

export async function handleVendorCommand(
  ctx: any,
  char: any,
  args: string[]
): Promise<string> {
  if (!ctx.vendors) return "Vendor service is not available.";
  if (!ctx.items) return "Item service is not available.";
  if (!ctx.characters) return "Character service is not available.";

  const sub = (args[0] ?? "").toLowerCase();

  // ---------------------------------------------------------------------------
  // vendor list <vendorId>
  // ---------------------------------------------------------------------------
  if (sub === "list" || sub === "") {
    const vendorId = args[1];
    if (!vendorId) return "Usage: vendor list <vendorId>";

    const vendor = await ctx.vendors.getVendor(vendorId);
    if (!vendor) return `No vendor found with id '${vendorId}'.`;

    const lines: string[] = [];
    lines.push(`Vendor: ${vendor.name} (${vendor.id})`);

    if (vendor.items.length === 0) {
      lines.push("  (no items for sale)");
    } else {
      vendor.items.forEach((vi: any, idx: number) => {
        const def = ctx.items!.get(vi.itemId);
        const name = def?.name ?? vi.itemId;
        const rarity = def?.rarity ?? "common";
        lines.push(
          `${idx + 1}) ${name} [${rarity}] - ${vi.priceGold} gold (itemId: ${vi.itemId})`
        );
      });
    }

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // vendor buy <vendorId> <index> [qty]
  // ---------------------------------------------------------------------------
  if (sub === "buy") {
    const vendorId = args[1];
    const idxStr = args[2];
    const qtyStr = args[3];

    if (!vendorId || !idxStr)
      return "Usage: vendor buy <vendorId> <index> [qty]";

    const vendor = await ctx.vendors.getVendor(vendorId);
    if (!vendor) return `No vendor found with id '${vendorId}'.`;

    const index = Number(idxStr);
    if (!Number.isInteger(index) || index < 1 || index > vendor.items.length) {
      return `Invalid index; choose between 1 and ${vendor.items.length}.`;
    }

    const qty = qtyStr ? Number(qtyStr) || 0 : 1;
    if (qty <= 0) return "Quantity must be a positive number.";

    const entry = vendor.items[index - 1];
    const def = ctx.items.get(entry.itemId);
    if (!def) return `Vendor is selling unknown item '${entry.itemId}'.`;

    const totalRequestedCost = entry.priceGold * qty;
    const currentGold = getCharacterGold(char);

    if (currentGold < totalRequestedCost) {
      return `You do not have enough gold. You need ${totalRequestedCost}, but have ${currentGold}.`;
    }

    const deliver = await deliverItemToBagsOrMail(ctx, {
      inventory: char.inventory,
      itemId: def.id,
      qty,

      ownerId: ctx.session?.identity?.userId,
      ownerKind: "account",

      sourceVerb: "buying",
      sourceName: def.name,
      mailSubject: "Vendor purchase overflow",
      mailBody: `Your bags were full while buying ${def.name}.\nThe remaining items were sent to your mailbox.`,

      // Never delete items just because mail isn't available; undelivered just isn't delivered.
      undeliveredPolicy: "keep",
    });

    const deliveredQty = deliver.added + deliver.mailed;

    // If absolutely nothing made it into bags or mail, abort and don't charge.
    if (deliveredQty === 0) return "Your bags are full; the vendor cannot complete the sale.";

    // Charge only for what was actually delivered (bags + mail)
    const actualCost = deliveredQty * entry.priceGold;
    setCharacterGold(char, currentGold - actualCost);

    await ctx.characters.saveCharacter(char);

    let msg = `You buy ${deliveredQty}x ${def.name} for ${actualCost} gold.`;
    if (deliver.mailed > 0) msg += ` (${deliver.mailed}x sent to your mailbox due to full bags.)`;

    return msg;
  }

  return "Usage: vendor list <vendorId> | vendor buy <vendorId> <index> [qty]";
}
