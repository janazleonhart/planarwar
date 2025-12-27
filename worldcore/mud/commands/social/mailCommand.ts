//worldcore/mud/commands/social/mailCommand.ts

import { getStaffRole } from "../../../shared/AuthTypes";
import { logStaffAction } from "../../../auth/StaffAuditLog";

type MailListEntry = {
  id: number;
  read: boolean;
  sentAt: string;
  senderName: string;
  subject: string;
  hasAttachments: boolean;
};

type MailAttachment = { itemId: string; qty: number };

type MailDetail = {
  id: number;
  read: boolean;
  sentAt: string;
  senderName: string;
  subject: string;
  body: string;
  attachments: MailAttachment[];
};

export async function handleMailCommand(ctx: MailCommandContext, args: string[]): Promise<string> {
  if (!ctx.mail) return "Mail service unavailable.";
  const identity = ctx.session.identity;
  if (!identity) return "You are not logged in.";

  const ownerId = identity.userId;
  const ownerKind: "account" = "account";

  const sub = (args[0] ?? "list").toLowerCase();

  if (sub === "list") {
    const list = await ctx.mail.listMail(ownerId, ownerKind) as MailListEntry[];
    if (list.length === 0) return "Your mailbox is empty.";

    return list
      .map(
        (m) =>
          `#${m.id} ${m.read ? " " : "*"} [${m.sentAt}] ${m.senderName}: ${m.subject}${
            m.hasAttachments ? " (attachments)" : ""
          }`
      )
      .join("\n");
  }

  if (sub === "read") {
    const idStr = args[1];
    if (!idStr) return "Usage: mail read <id>";
    const mailId = Number(idStr);
    if (!Number.isInteger(mailId) || mailId <= 0) return "Invalid mail id.";

    const detail = await ctx.mail.getMail(ownerId, ownerKind, mailId) as MailDetail | null;
    if (!detail) return `No mail with id ${mailId}.`;

    await ctx.mail.markRead(ownerId, ownerKind, mailId);

    const header = `From: ${detail.senderName}\nSubject: ${detail.subject}\nDate: ${detail.sentAt}\n`;
    const attachLine =
      detail.attachments.length > 0
        ? `Attachments: ${detail.attachments.map((a) => `${a.qty}x ${a.itemId}`).join(", ")}\n`
        : "";
    return `${header}${attachLine}\n${detail.body}`;
  }

  if (sub === "claim") {
    const idStr = args[1];
    if (!idStr) return "Usage: mail claim <id>";
    const mailId = Number(idStr);
    if (!Number.isFinite(mailId)) return "Invalid mail id.";
    if (!ctx.characters) return "Character service unavailable.";

    const char = ctx.session.character;
    if (!char) return "No active character.";

    const res = await ctx.mail.claimAttachments(ownerId, ownerKind, mailId, char);
    await ctx.characters.saveCharacter(char);

    if (res.claimed === 0) {
      return "No attachments could be claimed (bags may be full).";
    }

    let line = `Claimed ${res.claimed} item(s) from mail #${mailId}.`;
    if (res.leftover > 0) {
      line += ` ${res.leftover} item(s) remain in the mail.`;
    }
    return line;
  }

  // dev/admin helper commands (if you want them here too)
  if (sub === "event_reward") {
    const token = args[1];
    const qty = Math.max(1, Math.floor(Number(args[2] ?? "1") || 1));

    if (!token) return "Usage: mail event_reward <itemIdOrName> [qty]";
    if (!ctx.items) return "Item service unavailable.";

    const role = getStaffRole(identity.flags);
    if (role !== "owner" && role !== "dev" && role !== "gm") {
      return "You are not allowed to send event reward mail.";
    }

    const def = ctx.items.get(token) ?? ctx.items.findByIdOrName?.(token);
    if (!def) return `No DB item found for '${token}'.`;

    await ctx.mail.sendSystemMail(
      identity.userId,
      "account",
      "Event Reward",
      `Thank you for participating in an event.\nYou have been awarded ${qty}x ${def.name}.`,
      [{ itemId: def.id, qty }]
    );

    await logStaffAction(ctx.session.identity, "event_mail_reward", {
      targetAccountId: identity.userId,
      targetDisplayName: identity.displayName,
      itemId: def.id,
      itemName: def.name,
      qty,
    });

    return `Event reward mailed: ${qty} x ${def.name}.`;
  }

  return "Usage: mail [list|read <id>|claim <id>]";
}

type MailCommandContext = {
  mail?: any;
  items?: any;
  characters?: any;
  session: {
    identity?: any;
    character?: any;
  };
};