--- worldcore/infra/schema/025_bank_accounts.sql

CREATE TABLE IF NOT EXISTS bank_accounts (
  owner_id   TEXT    NOT NULL,
  owner_kind TEXT    NOT NULL,
  gold       BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, owner_kind)
);
