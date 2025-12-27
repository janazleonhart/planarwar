// worldcore/config/ShardConfig.ts

export type ShardMode = "dev" | "live";

export const ShardConfig: { mode: ShardMode } = {
  mode: (process.env.PW_SHARD_MODE as ShardMode) ?? "live",
};
