// worldcore/mail/PostgresMailService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import type { CharacterState } from "../characters/CharacterTypes";
import { giveItemsToCharacter } from "../economy/EconomyHelpers";
import type {
  MailOwnerKind,
  MailAttachment,
  MailSummary,
  MailDetail,
} from "./MailTypes";
import type { MailService } from "./MailService";

const log = Logger.scope("MAIL");

interface MailboxRow {
  id: number;
  owner_id: string;
  owner_kind: string;
  created_at: Date;
}

interface MailRow {
  id: number;
  mailbox_id: number;
  sender_name: string;
  subject: string;
  body: string;
  sent_at: Date;
  read_at: Date | null;
  expires_at: Date | null;
  is_system: boolean;
}

interface MailItemRow {
  id: number;
  mail_id: number;
  item_id: string;
  qty: number;
  meta: unknown;
}

type MailSummaryRow = MailRow & {
  has_attachments: boolean;
};

export class PostgresMailService implements MailService {
  async getOrCreateMailbox(
    ownerId: string,
    ownerKind: MailOwnerKind,
  ): Promise<number> {
    const existingRes = await db.query(
      `
        SELECT *
        FROM mailboxes
        WHERE owner_id = $1 AND owner_kind = $2
      `,
      [ownerId, ownerKind],
    );

    const existingRow = existingRes.rows[0] as MailboxRow | undefined;
    if (existingRow) {
      return existingRow.id;
    }

    const insertedRes = await db.query(
      `
        INSERT INTO mailboxes (owner_id, owner_kind)
        VALUES ($1, $2)
        RETURNING *
      `,
      [ownerId, ownerKind],
    );

    log.info("Created mailbox", { ownerId, ownerKind });

    const insertedRow = insertedRes.rows[0] as MailboxRow;
    return insertedRow.id;
  }

  async listMail(
    ownerId: string,
    ownerKind: MailOwnerKind,
  ): Promise<MailSummary[]> {
    const mailboxId = await this.getOrCreateMailbox(ownerId, ownerKind);

    const res = await db.query(
      `
        SELECT
          m.*,
          EXISTS (
            SELECT 1
            FROM mail_items mi
            WHERE mi.mail_id = m.id
          ) AS has_attachments
        FROM mails m
        WHERE m.mailbox_id = $1
        ORDER BY m.sent_at DESC
      `,
      [mailboxId],
    );

    const rows = res.rows as MailSummaryRow[];

    return rows.map(
      (row): MailSummary => ({
        id: row.id,
        senderName: row.sender_name,
        subject: row.subject,
        sentAt: row.sent_at.toISOString(),
        read: !!row.read_at,
        hasAttachments: !!row.has_attachments,
      }),
    );
  }

  async getMail(
    ownerId: string,
    ownerKind: MailOwnerKind,
    mailId: number,
  ): Promise<MailDetail | null> {
    const mailboxId = await this.getOrCreateMailbox(ownerId, ownerKind);

    const mailRes = await db.query(
      `
        SELECT *
        FROM mails
        WHERE id = $1 AND mailbox_id = $2
      `,
      [mailId, mailboxId],
    );

    if (mailRes.rowCount === 0) return null;

    const mail = mailRes.rows[0] as MailRow;

    const itemsRes = await db.query(
      `
        SELECT *
        FROM mail_items
        WHERE mail_id = $1
        ORDER BY id ASC
      `,
      [mail.id],
    );

    const attachments: MailAttachment[] = (
      itemsRes.rows as MailItemRow[]
    ).map((row) => ({
      itemId: row.item_id,
      qty: row.qty,
      meta: (row.meta ?? {}) as Record<string, unknown>,
    }));

    const detail: MailDetail = {
      id: mail.id,
      senderName: mail.sender_name,
      subject: mail.subject,
      body: mail.body,
      sentAt: mail.sent_at.toISOString(),
      read: !!mail.read_at,
      hasAttachments: attachments.length > 0,
      attachments,
    };

    return detail;
  }

  async markRead(
    ownerId: string,
    ownerKind: MailOwnerKind,
    mailId: number,
  ): Promise<void> {
    const mailboxId = await this.getOrCreateMailbox(ownerId, ownerKind);
    await db.query(
      `
        UPDATE mails
        SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND mailbox_id = $2
      `,
      [mailId, mailboxId],
    );
  }

  async sendSystemMail(
    ownerId: string,
    ownerKind: MailOwnerKind,
    subject: string,
    body: string,
    attachments: MailAttachment[] = [],
    expiresAt?: Date,
  ): Promise<void> {
    const mailboxId = await this.getOrCreateMailbox(ownerId, ownerKind);

    const mailRes = await db.query(
      `
        INSERT INTO mails (
          mailbox_id,
          sender_name,
          subject,
          body,
          expires_at,
          is_system
        )
        VALUES ($1, $2, $3, $4, $5, true)
        RETURNING *
      `,
      [mailboxId, "System", subject, body, expiresAt ?? null],
    );

    const mail = mailRes.rows[0] as MailRow;

    if (attachments.length > 0) {
      const values: unknown[] = [];
      const chunks: string[] = [];

      attachments.forEach((att, idx) => {
        const baseIndex = idx * 4;
        // ($1, $2, $3, $4::jsonb), ($1, $6, $7, $8::jsonb), ...
        chunks.push(
          `($1, $${baseIndex + 2}, $${baseIndex + 3}, $${
            baseIndex + 4
          }::jsonb)`,
        );
        values.push(att.itemId, att.qty, JSON.stringify(att.meta ?? {}));
      });

      await db.query(
        `
          INSERT INTO mail_items (mail_id, item_id, qty, meta)
          VALUES ${chunks.join(", ")}
        `,
        [mail.id, ...values],
      );
    }

    log.info("Sent system mail", {
      mailboxId,
      mailId: mail.id,
      subject,
      attachments: attachments.length,
    });
  }

  async claimAttachments(
    ownerId: string,
    ownerKind: MailOwnerKind,
    mailId: number,
    char: CharacterState,
  ): Promise<{ claimed: number; leftover: number }> {
    const mailboxId = await this.getOrCreateMailbox(ownerId, ownerKind);

    // Verify ownership
    const mailRes = await db.query(
      `
        SELECT *
        FROM mails
        WHERE id = $1 AND mailbox_id = $2
      `,
      [mailId, mailboxId],
    );

    if (mailRes.rowCount === 0) {
      throw new Error("mail_not_found");
    }

    const itemsRes = await db.query(
      `
        SELECT *
        FROM mail_items
        WHERE mail_id = $1
        ORDER BY id ASC
      `,
      [mailId],
    );

    if (itemsRes.rowCount === 0) {
      // Nothing to claim, but mark read anyway
      await db.query(
        `
          UPDATE mails
          SET read_at = COALESCE(read_at, now())
          WHERE id = $1
        `,
        [mailId],
      );

      return { claimed: 0, leftover: 0 };
    }

    let claimed = 0;
    let leftover = 0;

    for (const row of itemsRes.rows as MailItemRow[]) {
      if (row.qty <= 0) {
        // Sanity cleanup
        await db.query(`DELETE FROM mail_items WHERE id = $1`, [row.id]);
        continue;
      }

      const result = giveItemsToCharacter(char, [
        {
          itemId: row.item_id,
          quantity: row.qty,
        },
      ]);

      const applied = result.applied.find(
        (s) => s.itemId === row.item_id,
      );
      const appliedQty = applied?.quantity ?? 0;

      claimed += appliedQty;

      const remainingQty = row.qty - appliedQty;
      if (remainingQty <= 0) {
        await db.query(`DELETE FROM mail_items WHERE id = $1`, [row.id]);
      } else {
        leftover += remainingQty;
        await db.query(
          `UPDATE mail_items SET qty = $1 WHERE id = $2`,
          [remainingQty, row.id],
        );
      }
    }

    await db.query(
      `
        UPDATE mails
        SET read_at = COALESCE(read_at, now())
        WHERE id = $1
      `,
      [mailId],
    );

    log.info("Mail attachments claimed", {
      ownerId,
      ownerKind,
      mailId,
      claimed,
      leftover,
    });

    return { claimed, leftover };
  }
}
