// worldcore/mail/MailService.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type {
  MailOwnerKind,
  MailSummary,
  MailDetail,
  MailAttachment,
} from "./MailTypes";

export interface MailService {
  getOrCreateMailbox(
    ownerId: string,
    ownerKind: MailOwnerKind,
  ): Promise<number>;

  listMail(
    ownerId: string,
    ownerKind: MailOwnerKind,
  ): Promise<MailSummary[]>;

  getMail(
    ownerId: string,
    ownerKind: MailOwnerKind,
    mailId: number,
  ): Promise<MailDetail | null>;

  markRead(
    ownerId: string,
    ownerKind: MailOwnerKind,
    mailId: number,
  ): Promise<void>;

  sendSystemMail(
    ownerId: string,
    ownerKind: MailOwnerKind,
    subject: string,
    body: string,
    attachments?: MailAttachment[],
    expiresAt?: Date,
  ): Promise<void>;

  /**
   * Try to move all attachments into the given character's inventory.
   * Returns how many item units were successfully claimed and how many
   * were left in the mail due to bag space limits.
   */
  claimAttachments(
    ownerId: string,
    ownerKind: MailOwnerKind,
    mailId: number,
    char: CharacterState,
  ): Promise<{ claimed: number; leftover: number }>;
}
