-- worldcore/infra/schema/006_world_properties.sql

CREATE TABLE IF NOT EXISTS world_properties (
    shard_id TEXT PRIMARY KEY,
    dome_center_x REAL,
    dome_center_z REAL,
    dome_radius REAL,
    dome_soft REAL
);
