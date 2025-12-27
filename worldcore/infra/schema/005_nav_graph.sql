-- worldcore/infra/schema/005_nav_graph.sql

CREATE TABLE IF NOT EXISTS nav_nodes (
    id SERIAL PRIMARY KEY,
    shard_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS nav_edges (
    id SERIAL PRIMARY KEY,
    shard_id TEXT NOT NULL,
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    cost REAL DEFAULT 1.0
);
