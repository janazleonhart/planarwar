//worldcore/config/logconfig.ts

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

function parseLevel(raw: string | undefined | null): LogLevel | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v === "debug" || v === "info" || v === "warn" || v === "error") {
    return v;
  }
  return null;
}

// Global default from env, falls back to "info"
const GLOBAL_LEVEL: LogLevel = parseLevel(process.env.LOG_LEVEL) ?? "info";

// Per-scope defaults (can be overridden by env per scope)
const PER_SCOPE_DEFAULTS: Record<string, LogLevel> = {
  SERVER: "debug",
  ROUTER: "debug",
  HEARTBEAT: "info",
  ENTITY: "debug",
  ROOM: "debug",
  ROOMS: "debug",
  COMBAT: "debug",
  MOVEMENT: "debug",

  WORLD: "debug",
  WORLDGEN: "debug",
  REGIONMAP: "debug",
  OBJGEN: "debug",
  OBJ_STREAM: "info",
  TERRAIN_STREAM: "debug",

  DB: "info",
};

// Allow env overrides like LOG_SCOPE_SERVER=warn, LOG_SCOPE_WORLD=info, etc.
function getScopeLevel(scope: string): LogLevel {
  const key = scope.toUpperCase();

  // 1) Explicit per-scope env override
  const envKey = `LOG_SCOPE_${key}`;
  const fromEnv = parseLevel(process.env[envKey]);
  if (fromEnv) return fromEnv;

  // 2) Default table
  const fromTable = PER_SCOPE_DEFAULTS[key];
  if (fromTable) return fromTable;

  // 3) Global fallback
  return GLOBAL_LEVEL;
}

export function logEnabled(scope: string, level: LogLevel): boolean {
  const effective = getScopeLevel(scope);
  const wantedIdx = ORDER.indexOf(effective);
  const levelIdx = ORDER.indexOf(level);

  if (wantedIdx === -1 || levelIdx === -1) {
    // If something weird happens, allow rather than silently dropping.
    return true;
  }

  return levelIdx >= wantedIdx;
}
