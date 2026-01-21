-- worldcore/infra/schema/043_create_npc_loot_table.sql
-- Create npc_loot table used by PostgresNpcService + web-backend adminNpcs routes.
-- Idempotent: safe to run multiple times.

BEGIN;

CREATE TABLE IF NOT EXISTS public.npc_loot (
    npc_id text NOT NULL,
    idx integer NOT NULL,
    item_id text NOT NULL,
    chance double precision NOT NULL,
    min_qty integer NOT NULL,
    max_qty integer NOT NULL
);

DO $$
BEGIN
  ALTER TABLE ONLY public.npc_loot
    ADD CONSTRAINT npc_loot_pkey PRIMARY KEY (npc_id, idx);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE ONLY public.npc_loot
    ADD CONSTRAINT npc_loot_npc_id_fkey FOREIGN KEY (npc_id)
      REFERENCES public.npcs(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
