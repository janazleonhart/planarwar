--
-- PostgreSQL database dump
--

\restrict SYDrGU1fSedBADrjyO6kgF04mrzPKwPIK6DyZVvNf9yVeNGZFu4AcCsQy3CZpom

-- Dumped from database version 14.20 (Ubuntu 14.20-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.20 (Ubuntu 14.20-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: quest_objective_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quest_objective_kind AS ENUM (
    'kill',
    'harvest',
    'item_turnin',
    'talk_to_npc',
    'visit_room',
    'talk_to'
);


--
-- Name: quest_reward_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quest_reward_kind AS ENUM (
    'xp',
    'gold',
    'item',
    'title'
);


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    password_salt text NOT NULL,
    flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auction_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auction_log (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    shard_id text NOT NULL,
    listing_id bigint NOT NULL,
    actor_char_id text,
    actor_char_name text,
    action text NOT NULL,
    details jsonb
);


--
-- Name: auction_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auction_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auction_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auction_log_id_seq OWNED BY public.auction_log.id;


--
-- Name: auctions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auctions (
    id bigint NOT NULL,
    shard_id text NOT NULL,
    seller_char_id text NOT NULL,
    seller_char_name text NOT NULL,
    item_id text NOT NULL,
    qty integer NOT NULL,
    unit_price_gold integer NOT NULL,
    total_price_gold integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    buyer_char_id text,
    buyer_char_name text,
    sold_at timestamp with time zone,
    proceeds_gold integer,
    proceeds_claimed boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone,
    items_reclaimed boolean DEFAULT false NOT NULL,
    CONSTRAINT auctions_qty_check CHECK ((qty > 0)),
    CONSTRAINT auctions_total_price_gold_check CHECK ((total_price_gold > 0)),
    CONSTRAINT auctions_unit_price_gold_check CHECK ((unit_price_gold > 0))
);


--
-- Name: auctions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auctions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auctions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auctions_id_seq OWNED BY public.auctions.id;


--
-- Name: bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_accounts (
    owner_id text NOT NULL,
    owner_kind text NOT NULL,
    gold bigint DEFAULT 0 NOT NULL
);


--
-- Name: bank_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_slots (
    owner_id text NOT NULL,
    slot_index integer NOT NULL,
    item_id text NOT NULL,
    qty integer NOT NULL,
    meta jsonb,
    owner_kind text DEFAULT 'character'::text NOT NULL
);


--
-- Name: characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    shard_id text NOT NULL,
    name text NOT NULL,
    class_id text NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    xp bigint DEFAULT 0 NOT NULL,
    pos_x double precision DEFAULT 0 NOT NULL,
    pos_y double precision DEFAULT 0 NOT NULL,
    pos_z double precision DEFAULT 0 NOT NULL,
    last_region_id text,
    appearance_tag text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    inventory jsonb DEFAULT '{}'::jsonb NOT NULL,
    equipment jsonb DEFAULT '{}'::jsonb NOT NULL,
    spellbook jsonb DEFAULT '{}'::jsonb NOT NULL,
    abilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    progression jsonb DEFAULT '{}'::jsonb NOT NULL,
    state_version integer DEFAULT 1 NOT NULL,
    guild_id uuid
);


--
-- Name: guild_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guild_members (
    guild_id uuid NOT NULL,
    character_id uuid NOT NULL,
    rank text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: guilds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guilds (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    tag text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    id text NOT NULL,
    item_key text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    rarity text NOT NULL,
    category text,
    specialization_id text,
    icon_id text,
    max_stack integer DEFAULT 99 NOT NULL,
    flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_dev_only boolean DEFAULT false NOT NULL,
    grant_min_role text DEFAULT 'player'::text NOT NULL,
    CONSTRAINT items_grant_min_role_valid CHECK ((grant_min_role = ANY (ARRAY['player'::text, 'guide'::text, 'gm'::text, 'dev'::text, 'owner'::text])))
);


--
-- Name: mail_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_items (
    id bigint NOT NULL,
    mail_id bigint NOT NULL,
    item_id text NOT NULL,
    qty integer NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: mail_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mail_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mail_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mail_items_id_seq OWNED BY public.mail_items.id;


--
-- Name: mailboxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mailboxes (
    id bigint NOT NULL,
    owner_id text NOT NULL,
    owner_kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mailboxes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mailboxes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mailboxes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mailboxes_id_seq OWNED BY public.mailboxes.id;


--
-- Name: mails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mails (
    id bigint NOT NULL,
    mailbox_id bigint NOT NULL,
    sender_name text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    expires_at timestamp with time zone,
    is_system boolean DEFAULT false NOT NULL
);


--
-- Name: mails_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mails_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mails_id_seq OWNED BY public.mails.id;


--
-- Name: nav_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nav_edges (
    id integer NOT NULL,
    shard_id text NOT NULL,
    from_node text NOT NULL,
    to_node text NOT NULL,
    cost real DEFAULT 1.0
);


--
-- Name: nav_edges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nav_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nav_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nav_edges_id_seq OWNED BY public.nav_edges.id;


--
-- Name: nav_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nav_nodes (
    id integer NOT NULL,
    shard_id text NOT NULL,
    node_id text NOT NULL,
    x real NOT NULL,
    y real NOT NULL,
    z real NOT NULL
);


--
-- Name: nav_nodes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nav_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nav_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nav_nodes_id_seq OWNED BY public.nav_nodes.id;


--
-- Name: npc_loot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.npc_loot (
    npc_id text NOT NULL,
    idx integer NOT NULL,
    item_id text NOT NULL,
    chance double precision NOT NULL,
    min_qty integer NOT NULL,
    max_qty integer NOT NULL
);


--
-- Name: npcs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.npcs (
    id text NOT NULL,
    name text NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    max_hp integer NOT NULL,
    dmg_min integer NOT NULL,
    dmg_max integer NOT NULL,
    model text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    xp_reward integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quest_objectives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quest_objectives (
    id bigint NOT NULL,
    quest_id text NOT NULL,
    idx integer NOT NULL,
    kind public.quest_objective_kind NOT NULL,
    target_id text NOT NULL,
    required integer DEFAULT 1 NOT NULL,
    extra_json jsonb
);


--
-- Name: quest_objectives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quest_objectives_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quest_objectives_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quest_objectives_id_seq OWNED BY public.quest_objectives.id;


--
-- Name: quest_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quest_rewards (
    id bigint NOT NULL,
    quest_id text NOT NULL,
    kind public.quest_reward_kind NOT NULL,
    amount integer,
    item_id text,
    item_qty integer,
    title_id text,
    extra_json jsonb
);


--
-- Name: quest_rewards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quest_rewards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quest_rewards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quest_rewards_id_seq OWNED BY public.quest_rewards.id;


--
-- Name: quests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quests (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    repeatable boolean DEFAULT false NOT NULL,
    max_repeats integer,
    min_level integer,
    category text,
    tags text[] DEFAULT '{}'::text[],
    is_enabled boolean DEFAULT true NOT NULL,
    designer text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: region_polygons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.region_polygons (
    id integer NOT NULL,
    shard_id text,
    region_id text NOT NULL,
    px real NOT NULL,
    pz real NOT NULL
);


--
-- Name: region_polygons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.region_polygons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: region_polygons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.region_polygons_id_seq OWNED BY public.region_polygons.id;


--
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    id integer NOT NULL,
    shard_id text,
    region_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    flags jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: regions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.regions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: regions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.regions_id_seq OWNED BY public.regions.id;


--
-- Name: shards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shards (
    shard_id text NOT NULL,
    name text NOT NULL,
    seed bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    world_version integer DEFAULT 1
);


--
-- Name: skin_loot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skin_loot (
    id bigint NOT NULL,
    npc_proto_id text,
    npc_tag text,
    item_id text NOT NULL,
    chance real DEFAULT 1.0 NOT NULL,
    min_qty integer DEFAULT 1 NOT NULL,
    max_qty integer DEFAULT 1 NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skin_loot_chance_check CHECK (((chance >= (0.0)::double precision) AND (chance <= (1.0)::double precision))),
    CONSTRAINT skin_loot_check CHECK ((max_qty >= min_qty)),
    CONSTRAINT skin_loot_check1 CHECK (((npc_proto_id IS NOT NULL) OR (npc_tag IS NOT NULL))),
    CONSTRAINT skin_loot_min_qty_check CHECK ((min_qty > 0))
);


--
-- Name: skin_loot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skin_loot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skin_loot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skin_loot_id_seq OWNED BY public.skin_loot.id;


--
-- Name: spawn_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spawn_points (
    id integer NOT NULL,
    shard_id text,
    spawn_id text NOT NULL,
    type text NOT NULL,
    archetype text NOT NULL,
    x real,
    y real,
    z real,
    region_id text,
    proto_id text,
    variant_id text,
    town_tier integer
);


--
-- Name: spawn_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spawn_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spawn_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.spawn_points_id_seq OWNED BY public.spawn_points.id;


--
-- Name: staff_action_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_action_log (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid NOT NULL,
    actor_name text NOT NULL,
    action_name text NOT NULL,
    details jsonb NOT NULL
);


--
-- Name: staff_action_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_action_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_action_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_action_log_id_seq OWNED BY public.staff_action_log.id;


--
-- Name: trade_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_log (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    a_char_id text NOT NULL,
    a_char_name text NOT NULL,
    b_char_id text NOT NULL,
    b_char_name text NOT NULL,
    a_gold_before integer NOT NULL,
    a_gold_after integer NOT NULL,
    b_gold_before integer NOT NULL,
    b_gold_after integer NOT NULL,
    a_items_given jsonb NOT NULL,
    a_items_received jsonb NOT NULL,
    b_items_given jsonb NOT NULL,
    b_items_received jsonb NOT NULL
);


--
-- Name: trade_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trade_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trade_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trade_log_id_seq OWNED BY public.trade_log.id;


--
-- Name: trade_recipe_inputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_recipe_inputs (
    recipe_id text NOT NULL,
    item_id text NOT NULL,
    qty integer NOT NULL,
    CONSTRAINT trade_recipe_inputs_qty_check CHECK ((qty > 0))
);


--
-- Name: trade_recipe_outputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_recipe_outputs (
    recipe_id text NOT NULL,
    item_id text NOT NULL,
    qty integer NOT NULL,
    CONSTRAINT trade_recipe_outputs_qty_check CHECK ((qty > 0))
);


--
-- Name: trade_recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_recipes (
    id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    station_kind text
);


--
-- Name: vendor_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_items (
    id bigint NOT NULL,
    vendor_id text NOT NULL,
    item_id text NOT NULL,
    price_gold integer NOT NULL
);


--
-- Name: vendor_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendor_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendor_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendor_items_id_seq OWNED BY public.vendor_items.id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id text NOT NULL,
    name text NOT NULL
);


--
-- Name: world_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_objects (
    id integer NOT NULL,
    shard_id text,
    object_id text NOT NULL,
    type text NOT NULL,
    x real,
    y real,
    z real,
    roty real,
    region_id text
);


--
-- Name: world_objects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.world_objects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: world_objects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.world_objects_id_seq OWNED BY public.world_objects.id;


--
-- Name: world_properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.world_properties (
    shard_id text NOT NULL,
    dome_center_x real,
    dome_center_z real,
    dome_radius real,
    dome_soft real
);


--
-- Name: auction_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auction_log ALTER COLUMN id SET DEFAULT nextval('public.auction_log_id_seq'::regclass);


--
-- Name: auctions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auctions ALTER COLUMN id SET DEFAULT nextval('public.auctions_id_seq'::regclass);


--
-- Name: mail_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_items ALTER COLUMN id SET DEFAULT nextval('public.mail_items_id_seq'::regclass);


--
-- Name: mailboxes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mailboxes ALTER COLUMN id SET DEFAULT nextval('public.mailboxes_id_seq'::regclass);


--
-- Name: mails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mails ALTER COLUMN id SET DEFAULT nextval('public.mails_id_seq'::regclass);


--
-- Name: nav_edges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nav_edges ALTER COLUMN id SET DEFAULT nextval('public.nav_edges_id_seq'::regclass);


--
-- Name: nav_nodes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nav_nodes ALTER COLUMN id SET DEFAULT nextval('public.nav_nodes_id_seq'::regclass);


--
-- Name: quest_objectives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_objectives ALTER COLUMN id SET DEFAULT nextval('public.quest_objectives_id_seq'::regclass);


--
-- Name: quest_rewards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_rewards ALTER COLUMN id SET DEFAULT nextval('public.quest_rewards_id_seq'::regclass);


--
-- Name: region_polygons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region_polygons ALTER COLUMN id SET DEFAULT nextval('public.region_polygons_id_seq'::regclass);


--
-- Name: regions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions ALTER COLUMN id SET DEFAULT nextval('public.regions_id_seq'::regclass);


--
-- Name: skin_loot id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skin_loot ALTER COLUMN id SET DEFAULT nextval('public.skin_loot_id_seq'::regclass);


--
-- Name: spawn_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spawn_points ALTER COLUMN id SET DEFAULT nextval('public.spawn_points_id_seq'::regclass);


--
-- Name: staff_action_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_action_log ALTER COLUMN id SET DEFAULT nextval('public.staff_action_log_id_seq'::regclass);


--
-- Name: trade_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_log ALTER COLUMN id SET DEFAULT nextval('public.trade_log_id_seq'::regclass);


--
-- Name: vendor_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_items ALTER COLUMN id SET DEFAULT nextval('public.vendor_items_id_seq'::regclass);


--
-- Name: world_objects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects ALTER COLUMN id SET DEFAULT nextval('public.world_objects_id_seq'::regclass);


--
-- Name: accounts accounts_display_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_display_name_key UNIQUE (display_name);


--
-- Name: accounts accounts_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_email_key UNIQUE (email);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: auction_log auction_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auction_log
    ADD CONSTRAINT auction_log_pkey PRIMARY KEY (id);


--
-- Name: auctions auctions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auctions
    ADD CONSTRAINT auctions_pkey PRIMARY KEY (id);


--
-- Name: bank_accounts bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (owner_id, owner_kind);


--
-- Name: bank_slots bank_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_slots
    ADD CONSTRAINT bank_slots_pkey PRIMARY KEY (owner_id, owner_kind, slot_index);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: guild_members guild_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guild_members
    ADD CONSTRAINT guild_members_pkey PRIMARY KEY (guild_id, character_id);


--
-- Name: guilds guilds_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guilds
    ADD CONSTRAINT guilds_name_key UNIQUE (name);


--
-- Name: guilds guilds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guilds
    ADD CONSTRAINT guilds_pkey PRIMARY KEY (id);


--
-- Name: guilds guilds_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guilds
    ADD CONSTRAINT guilds_tag_key UNIQUE (tag);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: mail_items mail_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_items
    ADD CONSTRAINT mail_items_pkey PRIMARY KEY (id);


--
-- Name: mailboxes mailboxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mailboxes
    ADD CONSTRAINT mailboxes_pkey PRIMARY KEY (id);


--
-- Name: mails mails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mails
    ADD CONSTRAINT mails_pkey PRIMARY KEY (id);


--
-- Name: nav_edges nav_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nav_edges
    ADD CONSTRAINT nav_edges_pkey PRIMARY KEY (id);


--
-- Name: nav_nodes nav_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nav_nodes
    ADD CONSTRAINT nav_nodes_pkey PRIMARY KEY (id);


--
-- Name: npc_loot npc_loot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.npc_loot
    ADD CONSTRAINT npc_loot_pkey PRIMARY KEY (npc_id, idx);


--
-- Name: npcs npcs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.npcs
    ADD CONSTRAINT npcs_pkey PRIMARY KEY (id);


--
-- Name: quest_objectives quest_objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_objectives
    ADD CONSTRAINT quest_objectives_pkey PRIMARY KEY (id);


--
-- Name: quest_rewards quest_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_rewards
    ADD CONSTRAINT quest_rewards_pkey PRIMARY KEY (id);


--
-- Name: quests quests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quests
    ADD CONSTRAINT quests_pkey PRIMARY KEY (id);


--
-- Name: region_polygons region_polygons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region_polygons
    ADD CONSTRAINT region_polygons_pkey PRIMARY KEY (id);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- Name: shards shards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shards
    ADD CONSTRAINT shards_pkey PRIMARY KEY (shard_id);


--
-- Name: skin_loot skin_loot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skin_loot
    ADD CONSTRAINT skin_loot_pkey PRIMARY KEY (id);


--
-- Name: spawn_points spawn_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spawn_points
    ADD CONSTRAINT spawn_points_pkey PRIMARY KEY (id);


--
-- Name: spawn_points spawn_points_town_tier_range; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.spawn_points
    ADD CONSTRAINT spawn_points_town_tier_range CHECK (((town_tier IS NULL) OR ((town_tier >= 1) AND (town_tier <= 5)))) NOT VALID;


--
-- Name: staff_action_log staff_action_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_action_log
    ADD CONSTRAINT staff_action_log_pkey PRIMARY KEY (id);


--
-- Name: trade_log trade_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_log
    ADD CONSTRAINT trade_log_pkey PRIMARY KEY (id);


--
-- Name: trade_recipe_inputs trade_recipe_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_recipe_inputs
    ADD CONSTRAINT trade_recipe_inputs_pkey PRIMARY KEY (recipe_id, item_id);


--
-- Name: trade_recipe_outputs trade_recipe_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_recipe_outputs
    ADD CONSTRAINT trade_recipe_outputs_pkey PRIMARY KEY (recipe_id, item_id);


--
-- Name: trade_recipes trade_recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_recipes
    ADD CONSTRAINT trade_recipes_pkey PRIMARY KEY (id);


--
-- Name: vendor_items vendor_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_items
    ADD CONSTRAINT vendor_items_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: world_objects world_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects
    ADD CONSTRAINT world_objects_pkey PRIMARY KEY (id);


--
-- Name: world_properties world_properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_properties
    ADD CONSTRAINT world_properties_pkey PRIMARY KEY (shard_id);


--
-- Name: bank_slots_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_slots_owner_idx ON public.bank_slots USING btree (owner_kind, owner_id);


--
-- Name: bank_slots_owner_slot_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bank_slots_owner_slot_uq ON public.bank_slots USING btree (owner_id, owner_kind, slot_index);


--
-- Name: idx_accounts_display_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_display_name ON public.accounts USING btree (display_name);


--
-- Name: idx_accounts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_email ON public.accounts USING btree (email);


--
-- Name: idx_auction_log_actor_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auction_log_actor_at ON public.auction_log USING btree (actor_char_id, at DESC);


--
-- Name: idx_auction_log_listing_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auction_log_listing_at ON public.auction_log USING btree (listing_id, at DESC);


--
-- Name: idx_auctions_active_shard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auctions_active_shard ON public.auctions USING btree (shard_id, status, created_at DESC);


--
-- Name: idx_auctions_seller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auctions_seller ON public.auctions USING btree (seller_char_id, status);


--
-- Name: idx_bank_slots_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_slots_owner ON public.bank_slots USING btree (owner_id);


--
-- Name: idx_bank_slots_owner_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_slots_owner_kind ON public.bank_slots USING btree (owner_id, owner_kind);


--
-- Name: idx_characters_name_shard; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_characters_name_shard ON public.characters USING btree (shard_id, lower(name));


--
-- Name: idx_characters_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_user ON public.characters USING btree (user_id);


--
-- Name: idx_characters_user_shard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_user_shard ON public.characters USING btree (user_id, shard_id);


--
-- Name: idx_guild_members_character; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guild_members_character ON public.guild_members USING btree (character_id);


--
-- Name: idx_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_category ON public.items USING btree (category);


--
-- Name: idx_items_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_key ON public.items USING btree (item_key);


--
-- Name: idx_items_rarity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_rarity ON public.items USING btree (rarity);


--
-- Name: idx_mail_items_mail; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mail_items_mail ON public.mail_items USING btree (mail_id);


--
-- Name: idx_mailboxes_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mailboxes_owner ON public.mailboxes USING btree (owner_id, owner_kind);


--
-- Name: idx_mails_mailbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mails_mailbox ON public.mails USING btree (mailbox_id, sent_at DESC);


--
-- Name: idx_skin_loot_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skin_loot_item ON public.skin_loot USING btree (item_id);


--
-- Name: idx_skin_loot_proto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skin_loot_proto ON public.skin_loot USING btree (npc_proto_id);


--
-- Name: idx_skin_loot_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skin_loot_tag ON public.skin_loot USING btree (npc_tag);


--
-- Name: idx_spawn_points_proto_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spawn_points_proto_variant ON public.spawn_points USING btree (proto_id, variant_id);


--
-- Name: idx_spawn_points_shard_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spawn_points_shard_region ON public.spawn_points USING btree (shard_id, region_id);


--
-- Name: idx_staff_action_log_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_action_log_actor ON public.staff_action_log USING btree (actor_id);


--
-- Name: idx_staff_action_log_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_action_log_at ON public.staff_action_log USING btree (at DESC);


--
-- Name: idx_trade_log_chars_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trade_log_chars_at ON public.trade_log USING btree (a_char_id, b_char_id, at DESC);


--
-- Name: idx_trade_recipes_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trade_recipes_category ON public.trade_recipes USING btree (category);


--
-- Name: idx_trade_recipes_station_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trade_recipes_station_kind ON public.trade_recipes USING btree (station_kind);


--
-- Name: idx_vendor_items_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_items_vendor ON public.vendor_items USING btree (vendor_id);


--
-- Name: quest_objectives_quest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quest_objectives_quest_idx ON public.quest_objectives USING btree (quest_id);


--
-- Name: quest_rewards_quest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quest_rewards_quest_idx ON public.quest_rewards USING btree (quest_id);


--
-- Name: quests_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quests_category_idx ON public.quests USING btree (category);


--
-- Name: quests_tags_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quests_tags_gin_idx ON public.quests USING gin (tags);


--
-- Name: npcs trg_npcs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_npcs_updated_at BEFORE UPDATE ON public.npcs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: characters characters_guild_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE SET NULL;


--
-- Name: characters characters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: guild_members guild_members_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guild_members
    ADD CONSTRAINT guild_members_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: guild_members guild_members_guild_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guild_members
    ADD CONSTRAINT guild_members_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;


--
-- Name: mail_items mail_items_mail_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_items
    ADD CONSTRAINT mail_items_mail_id_fkey FOREIGN KEY (mail_id) REFERENCES public.mails(id) ON DELETE CASCADE;


--
-- Name: mails mails_mailbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mails
    ADD CONSTRAINT mails_mailbox_id_fkey FOREIGN KEY (mailbox_id) REFERENCES public.mailboxes(id) ON DELETE CASCADE;


--
-- Name: npc_loot npc_loot_npc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.npc_loot
    ADD CONSTRAINT npc_loot_npc_id_fkey FOREIGN KEY (npc_id) REFERENCES public.npcs(id) ON DELETE CASCADE;


--
-- Name: quest_objectives quest_objectives_quest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_objectives
    ADD CONSTRAINT quest_objectives_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.quests(id) ON DELETE CASCADE;


--
-- Name: quest_rewards quest_rewards_quest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_rewards
    ADD CONSTRAINT quest_rewards_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.quests(id) ON DELETE CASCADE;


--
-- Name: region_polygons region_polygons_shard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region_polygons
    ADD CONSTRAINT region_polygons_shard_id_fkey FOREIGN KEY (shard_id) REFERENCES public.shards(shard_id) ON DELETE CASCADE;


--
-- Name: regions regions_shard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_shard_id_fkey FOREIGN KEY (shard_id) REFERENCES public.shards(shard_id) ON DELETE CASCADE;


--
-- Name: skin_loot skin_loot_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skin_loot
    ADD CONSTRAINT skin_loot_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: spawn_points spawn_points_shard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spawn_points
    ADD CONSTRAINT spawn_points_shard_id_fkey FOREIGN KEY (shard_id) REFERENCES public.shards(shard_id) ON DELETE CASCADE;


--
-- Name: trade_recipe_inputs trade_recipe_inputs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_recipe_inputs
    ADD CONSTRAINT trade_recipe_inputs_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: trade_recipe_inputs trade_recipe_inputs_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_recipe_inputs
    ADD CONSTRAINT trade_recipe_inputs_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.trade_recipes(id) ON DELETE CASCADE;


--
-- Name: trade_recipe_outputs trade_recipe_outputs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_recipe_outputs
    ADD CONSTRAINT trade_recipe_outputs_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: trade_recipe_outputs trade_recipe_outputs_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_recipe_outputs
    ADD CONSTRAINT trade_recipe_outputs_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.trade_recipes(id) ON DELETE CASCADE;


--
-- Name: vendor_items vendor_items_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_items
    ADD CONSTRAINT vendor_items_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: world_objects world_objects_shard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.world_objects
    ADD CONSTRAINT world_objects_shard_id_fkey FOREIGN KEY (shard_id) REFERENCES public.shards(shard_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict SYDrGU1fSedBADrjyO6kgF04mrzPKwPIK6DyZVvNf9yVeNGZFu4AcCsQy3CZpom

