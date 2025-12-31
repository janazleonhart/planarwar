// worldcore/mail/MailTypes.ts

export type MailOwnerKind = "account" | "character";

export interface MailAttachment {
  itemId: string;
  qty: number;
  meta?: Record<string, unknown>;
}

export interface MailSummary {
  id: number;
  senderName: string;
  subject: string;
  sentAt: string; // ISO
  read: boolean;
  hasAttachments: boolean;
}

export interface MailDetail extends MailSummary {
  body: string;
  attachments: MailAttachment[];
}
