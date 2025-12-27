//worldcore/config/config.ts

export const Config = {
  WS_HOST: process.env.PW_WS_HOST ?? "0.0.0.0",
  WS_PORT: Number(process.env.PW_WS_PORT ?? 7777),

  HEARTBEAT_INTERVAL_MS: 30_000,
  HEARTBEAT_TIMEOUT_MS: 120_000,
};
