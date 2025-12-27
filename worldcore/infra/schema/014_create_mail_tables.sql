--- worldcore/db/migrations/014_create_mail_tables.sql

CREATE TABLE IF NOT EXISTS mailboxes (
  id          bigserial PRIMARY KEY,
  owner_id    text NOT NULL,
  owner_kind  text NOT NULL,  -- 'account' | 'character'
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mailboxes_owner_unique UNIQUE (owner_id, owner_kind)
);

CREATE INDEX IF NOT EXISTS idx_mailboxes_owner
  ON mailboxes (owner_id, owner_kind);

CREATE TABLE IF NOT EXISTS mails (
  id           bigserial PRIMARY KEY,
  mailbox_id   bigint NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  sender_name  text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  expires_at   timestamptz,
  is_system    boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_mails_mailbox
  ON mails (mailbox_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS mail_items (
  id        bigserial PRIMARY KEY,
  mail_id   bigint NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
  item_id   text NOT NULL,
  qty       integer NOT NULL,
  meta      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_mail_items_mail
  ON mail_items (mail_id);
