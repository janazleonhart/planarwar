// mmo-backend/config.ts

export interface NetworkConfig {
  host: string;
  port: number;
  path: string;
  heartbeatIntervalMs: number;
  idleTimeoutMs: number;
  tickIntervalMs: number;
  authOptional: boolean;
}

// Defaults (human readable)
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;      // 5 seconds
const DEFAULT_IDLE_TIMEOUT_MS       = 10 * 60_000; // 10 minutes
const DEFAULT_TICK_INTERVAL_MS      = 50;         // 20 TPS

export const netConfig: NetworkConfig = {
  host: process.env.PW_MMO_HOST || "0.0.0.0",
  port: Number(process.env.PW_MMO_PORT || 7777),
  path: "/ws",

  // How often the Heartbeat sweeps sessions for idleness
  heartbeatIntervalMs: Number(
    process.env.PW_HEARTBEAT_INTERVAL || DEFAULT_HEARTBEAT_INTERVAL_MS
  ),

  // How long a session can be idle (no messages) before we drop it
  // Default: 10 minutes
  idleTimeoutMs: Number(
    process.env.PW_IDLE_TIMEOUT || DEFAULT_IDLE_TIMEOUT_MS
  ),

  // Main gameplay TickEngine interval
  tickIntervalMs: Number(
    process.env.PW_TICK_INTERVAL || DEFAULT_TICK_INTERVAL_MS
  ),

  // 👇 default: auth is optional in dev; set PW_AUTH_OPTIONAL=false in prod
  authOptional: process.env.PW_AUTH_OPTIONAL !== "false",
};
