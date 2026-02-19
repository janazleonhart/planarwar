// mother-brain/Goals.ts
//
// Mother Brain Goals (v0.20+): a tiny, safe “test pilot” layer.
//
// Design goals:
// - Observe-only by default.
// - Hot-reloadable from disk (JSON file).
// - Optional ad-hoc goal sets via HTTP endpoint (in-memory only).
// - Structured reporting to a dedicated JSONL file under the log directory.
// - Optional “goal packs” (prebuilt suites) selectable via env.

import fs from "node:fs";
import path from "node:path";

export type GoalKind =
  | "db_table_exists"
  | "db_wave_budget_breaches"
  | "ws_connected"
  | "ws_mud"
  | "ws_mud_script"
  | "http_get"
  | "http_json"
  | "http_post_json";

export type WsMudScriptStep = {
  command: string;
  timeoutMs?: number;
  expectIncludes?: string;
  expectIncludesAny?: string[];
  expectIncludesAll?: string[];
};

export type GoalDefinition = {
  id: string;
  kind: GoalKind;
  enabled?: boolean;

  // db_table_exists
  table?: string;

  // http_get
  url?: string;
  expectStatus?: number;
  timeoutMs?: number;

  // Optional retry behavior (primarily for startup-order/race conditions)
  // Retries only apply to transient network errors (ECONNREFUSED/ENOTFOUND/ETIMEDOUT/EAI_AGAIN) and 502/503/504 statuses.
  retries?: number;
  retryDelayMs?: number;

  // http_json
  // If provided, Mother Brain will parse the response as JSON and validate.
  // - expectPath + expectValue: dot-path equality (supports numeric array indexes)
  // - expectSubset: partial deep match (all keys/values must exist in response)
  // - expectJson: deep equality with the whole parsed JSON
  expectPath?: string;
  expectValue?: unknown;
  expectSubset?: Record<string, unknown>;
  expectJson?: unknown;

  // Optional request headers for http_json/http_post_json (e.g. admin auth)
  requestHeaders?: Record<string, string>;

  // http_post_json
  // Sends a JSON POST body and (optionally) validates JSON response.
  requestJson?: unknown;

  // ws_mud
  command?: string;
  expectIncludes?: string;

  expectIncludesAny?: string[];
  expectIncludesAll?: string[];

  // ws_mud_script
  script?: WsMudScriptStep[];
  scriptDelayMs?: number;
  scriptStopOnFail?: boolean;

  // db_wave_budget_breaches
  maxBreaches?: number;
};

export type GoalRunResult = {
  id: string;
  kind: GoalKind;
  ok: boolean;
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
};

export type GoalRunReport = {
  ts: string;
  tick: number;
  ok: boolean;
  results: GoalRunResult[];
  summary: {
    total: number;
    ok: number;
    fail: number;
    skipped: number;
  };
};

export type GoalsState = {
  filePath?: string;
  reportDir?: string;
  // Note: reports are written per-suite (pack) when packs are active.
  // When custom goals are active (file/in-memory), a single "custom" report is written.
  everyTicks: number;

  // Optional suite selection
  packIds: string[];

  // Optional context for builtin packs
  webBackendHttpBase?: string;
  webBackendAdminToken?: string;
  webBackendServiceToken?: string;

  lastRunIso: string | null;
  lastOk: boolean | null;
  lastSummary: GoalRunReport["summary"] | null;

  // Per-suite status (populated when packs are used; also works for single-suite runs)
  lastBySuite?: Record<
    string,
    {
      lastRunIso: string;
      ok: boolean;
      summary: GoalRunReport["summary"];
    }
  >;

  // Recent failing goal previews per-suite (capped). Used for UI surfacing.
  lastFailingGoalsBySuite?: Record<string, GoalRunResult[]>;

  // If set via HTTP, overrides file goals until cleared.
  inMemoryGoals: GoalDefinition[] | null;
};

export type GoalsSuiteHealthSummary = {
  status: "OK" | "FAIL" | "STALE";
  ageSec: number | null;
  okCount: number | null;
  failCount: number | null;
  totalCount: number | null;
};

export type GoalsFailingGoalPreview = {
  suiteId: string;
  id: string;
  kind: GoalKind;
  error: string | null;
  latencyMs: number | null;
  details: Record<string, unknown> | null;
};

export type GoalsHealthSummary = {
  ok: boolean | null;
  summary: GoalRunReport["summary"] | null;
  okCount: number | null;
  failCount: number | null;
  totalCount: number | null;
  failingGoals?: GoalsFailingGoalPreview[];
};

export type GoalsHealth = {
  status: "OK" | "FAIL" | "STALE";
  lastRunIso: string | null;
  ageSec: number | null;
  overall?: GoalsHealthSummary;
  suites?: {
    total: number;
    ok: number;
    fail: number;
    failingSuites: string[];
  };
  bySuite?: Record<string, GoalsSuiteHealthSummary>;
};

export type GoalsDeps = {
  nowIso: () => string;
  // DB query helper – should return rows (or null if DB disabled).
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] } | null>;
  // Optional precomputed wave-budget snapshot.
  waveBudget:
    | {
        ok: true;
        breaches?: { shardId: string; type: string; cap: number; used: number; overBy: number; policy: string }[];
      }
    | { ok: false; reason: string }
    | null;
  // WS connection state.
  wsState: "disabled" | "closed" | "connecting" | "open";
  // Optional WS MUD command helper (if WS is configured).
  wsMudCommand?: (command: string, timeoutMs: number) => Promise<{ ok: boolean; output?: string; error?: string }>;
  // Logger
  log: (level: "debug" | "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => void;
};

function safeReadJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as unknown;
}

function normalizeGoals(maybeGoals: unknown): GoalDefinition[] {
  if (!Array.isArray(maybeGoals)) return [];

  const out: GoalDefinition[] = [];
  for (const g of maybeGoals) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    const kind = typeof o.kind === "string" ? (o.kind as GoalKind) : null;
    if (!id || !kind) continue;
    out.push({
      id,
      kind,
      enabled: typeof o.enabled === "boolean" ? o.enabled : true,
      table: typeof o.table === "string" ? o.table : undefined,
      url: typeof o.url === "string" ? o.url : undefined,
      expectStatus: typeof o.expectStatus === "number" ? o.expectStatus : undefined,
      timeoutMs: typeof o.timeoutMs === "number" ? o.timeoutMs : undefined,
      retries: typeof (o as any).retries === "number" ? (o as any).retries : undefined,
      retryDelayMs: typeof (o as any).retryDelayMs === "number" ? (o as any).retryDelayMs : undefined,
      expectPath: typeof o.expectPath === "string" ? o.expectPath : undefined,
      expectValue: "expectValue" in o ? (o as any).expectValue : undefined,
      expectSubset: (o as any).expectSubset && typeof (o as any).expectSubset === "object" ? ((o as any).expectSubset as any) : undefined,
      expectJson: "expectJson" in o ? (o as any).expectJson : undefined,
      requestJson: "requestJson" in o ? (o as any).requestJson : undefined,
      requestHeaders:
        (o as any).requestHeaders && typeof (o as any).requestHeaders === "object" ? ((o as any).requestHeaders as any) : undefined,
      command: typeof o.command === "string" ? o.command : undefined,
      expectIncludes: typeof o.expectIncludes === "string" ? o.expectIncludes : undefined,
      expectIncludesAny: Array.isArray((o as any).expectIncludesAny)
        ? (o as any).expectIncludesAny.filter((x: any) => typeof x === "string")
        : undefined,
      expectIncludesAll: Array.isArray((o as any).expectIncludesAll)
        ? (o as any).expectIncludesAll.filter((x: any) => typeof x === "string")
        : undefined,
      script: Array.isArray((o as any).script)
        ? (o as any).script
            .filter((s: any) => s && typeof s === "object")
            .map((s: any) => ({
              command: String(s.command ?? ""),
              timeoutMs: typeof s.timeoutMs === "number" ? s.timeoutMs : undefined,
              expectIncludes: typeof s.expectIncludes === "string" ? s.expectIncludes : undefined,
              expectIncludesAny: Array.isArray(s.expectIncludesAny)
                ? s.expectIncludesAny.filter((x: any) => typeof x === "string")
                : undefined,
              expectIncludesAll: Array.isArray(s.expectIncludesAll)
                ? s.expectIncludesAll.filter((x: any) => typeof x === "string")
                : undefined,
            }))
            .filter((s: any) => typeof s.command === "string" && s.command.trim().length > 0)
        : undefined,
      scriptDelayMs: typeof (o as any).scriptDelayMs === "number" ? (o as any).scriptDelayMs : undefined,
      scriptStopOnFail: typeof (o as any).scriptStopOnFail === "boolean" ? (o as any).scriptStopOnFail : undefined,
      maxBreaches: typeof o.maxBreaches === "number" ? o.maxBreaches : undefined,
    });
  }

  return out;
}

export function defaultGoals(): GoalDefinition[] {
  return [
    { id: "db.service_heartbeats.exists", kind: "db_table_exists", table: "service_heartbeats" },
    { id: "db.spawn_points.exists", kind: "db_table_exists", table: "spawn_points" },
    // If wave budget snapshot is present, ensure we aren't over cap.
    { id: "wave_budget.no_breaches", kind: "db_wave_budget_breaches", maxBreaches: 0 },
    // If WS URL is configured, ensure it is connected.
    { id: "ws.connected", kind: "ws_connected" },
  ];
}

// -----------------------------------------------------------------------------
// Goal packs (prebuilt suites)
// -----------------------------------------------------------------------------

export type GoalPackId =
  | "core"
  | "db"
  | "wave_budget"
  | "ws"
  | "player_smoke"
  | "admin_smoke"
  | "web_smoke"
  | "all_smoke";

export function builtinGoalPacks(ctx?: {
  webBackendHttpBase?: string;
  webBackendAdminToken?: string;
  webBackendServiceToken?: string;
}): Record<GoalPackId, GoalDefinition[]> {
  // NOTE: When building packs via ternaries/spreads, TS can widen string literals (e.g. kind -> string).
  // To keep GoalDefinition typing strict, build those packs in typed locals.

  const webSmoke: GoalDefinition[] = ctx?.webBackendHttpBase
    ? ([
        {
          id: "web.healthz",
          kind: "http_json",
          url: `${ctx.webBackendHttpBase}/api/healthz`,
          expectStatus: 200,
          expectPath: "ok",
          expectValue: true,
          timeoutMs: 1500,
        },
        {
          id: "web.readyz",
          kind: "http_json",
          url: `${ctx.webBackendHttpBase}/api/readyz`,
          // readyz can legitimately be 503 in dev if DB env is not configured.
          // We treat that as a soft check by not pinning expectStatus.
          expectPath: "service",
          expectValue: "web-backend",
          timeoutMs: 1500,
        },
      ] satisfies GoalDefinition[])
    : ([
        {
          id: "web_smoke.disabled",
          kind: "http_get",
          url: "http://invalid.local/disabled",
          enabled: false,
        },
      ] satisfies GoalDefinition[]);
  const adminToken = ctx?.webBackendAdminToken;
  const serviceToken = ctx?.webBackendServiceToken;
  const serviceRole = serviceToken?.startsWith("svc:") ? String(serviceToken.split(":")[2] ?? "") : "";
  const adminHeaders: Record<string, string> | undefined = adminToken
    ? {
        // Prefer standards, but also include a simple token header for flexibility.
        authorization: adminToken.toLowerCase().startsWith("bearer ") ? adminToken : `Bearer ${adminToken}`,
        "x-admin-token": adminToken,
      }
    : serviceToken
      ? {
          // Service tokens are verified server-side via PW_SERVICE_TOKEN_SECRET.
          // We provide both a dedicated header and a Bearer form for compatibility.
          authorization: serviceToken.toLowerCase().startsWith("bearer ") ? serviceToken : `Bearer ${serviceToken}`,
          "x-service-token": serviceToken,
        }
      : undefined;

  const adminSmoke: GoalDefinition[] = ctx?.webBackendHttpBase && adminHeaders
    ? (
        [
          {
            id: "admin.fixtures.time",
            kind: "http_json",
            url: `${ctx.webBackendHttpBase}/api/admin/test_fixtures/time`,
            requestHeaders: adminHeaders,
            expectStatus: 200,
            expectPath: "ok",
            expectValue: true,
            timeoutMs: 2000,
          },
          // NOTE: readonly service tokens are not allowed to exercise write-ish endpoints.
          // Use the deterministic GET ping variant instead so admin_smoke can stay green
          // under least privilege.
          (
            serviceToken && serviceRole === "readonly"
              ? ({
                  id: "admin.fixtures.ping",
                  kind: "http_json",
                  url: `${ctx.webBackendHttpBase}/api/admin/test_fixtures/ping`,
                  requestHeaders: adminHeaders,
                  expectStatus: 200,
                  expectPath: "pong",
                  expectValue: "pong",
                  timeoutMs: 2000,
                } satisfies GoalDefinition)
              : ({
                  id: "admin.fixtures.ping",
                  kind: "http_post_json",
                  url: `${ctx.webBackendHttpBase}/api/admin/test_fixtures/ping`,
                  requestHeaders: adminHeaders,
                  requestJson: { ping: 7 },
                  expectStatus: 200,
                  expectPath: "pong",
                  expectValue: 7,
                  timeoutMs: 2000,
                } satisfies GoalDefinition)
          ),
          {
            id: "admin.fixtures.db_counts",
            kind: "http_json",
            url: `${ctx.webBackendHttpBase}/api/admin/test_fixtures/db_counts`,
            requestHeaders: adminHeaders,
            expectStatus: 200,
            expectPath: "ok",
            expectValue: true,
            timeoutMs: 3000,
          },
        ] satisfies GoalDefinition[]
      )
    : ([
        {
          id: "admin_smoke.disabled",
          kind: "http_get",
          url: "http://invalid.local/disabled",
          enabled: false,
        },
      ] satisfies GoalDefinition[]);


  const corePack: GoalDefinition[] = [
    { id: "db.service_heartbeats.exists", kind: "db_table_exists", table: "service_heartbeats" },
    { id: "db.spawn_points.exists", kind: "db_table_exists", table: "spawn_points" },
    { id: "wave_budget.no_breaches", kind: "db_wave_budget_breaches", maxBreaches: 0 },
    { id: "ws.connected", kind: "ws_connected" },
  ];

  const playerSmoke: GoalDefinition[] = [
    // Stable, low-brittle: "whereami" should always produce some kind of location text.
    {
      id: "ws.mud.whereami",
      kind: "ws_mud",
      command: "whereami",
      expectIncludesAny: ["You are", "Location", "Zone", "Room"],
      timeoutMs: 2500,
    },

    // Player-facing command loop smoke (stable: these commands should work everywhere once a character is attached).
    {
      id: "ws.mud.player_loop.core",
      kind: "ws_mud_script",
      timeoutMs: 2500,
      retries: 2,
      retryDelayMs: 250,
      scriptDelayMs: 50,
      scriptStopOnFail: true,
      script: [
        { command: "help", expectIncludes: "Available commands:" },
        { command: "quest help", expectIncludes: "Quest Board" },
        { command: "attack", expectIncludes: "[combat] You are not engaged" },
        { command: "pet", expectIncludes: "[pet] Commands:" },
      ],
    },

    // Optional protocol/command dependent checks (disabled until confirmed).
    { id: "ws.mud.look", kind: "ws_mud", enabled: false, command: "look", expectIncludesAny: ["You see", "Exits", "Around you"], timeoutMs: 2500 },
    { id: "ws.mud.say", kind: "ws_mud", enabled: false, command: "say mother brain ping", expectIncludesAny: ["You say", "says"], timeoutMs: 2500 },
    { id: "ws.mud.move.north", kind: "ws_mud", enabled: false, command: "north", expectIncludesAny: ["You move", "You go", "You arrive", "Exits"], timeoutMs: 2500 },
  ];
  return {
    core: corePack,
    db: [
      { id: "db.service_heartbeats.exists", kind: "db_table_exists", table: "service_heartbeats" },
      { id: "db.spawn_points.exists", kind: "db_table_exists", table: "spawn_points" },
    ],
    wave_budget: [{ id: "wave_budget.no_breaches", kind: "db_wave_budget_breaches", maxBreaches: 0 }],
    ws: [{ id: "ws.connected", kind: "ws_connected" }],

    // Player-facing smoke checks (requires WS to be configured for an authenticated character session).
    // Only the first goal is enabled by default (very stable assertion). The others are optional and
    // intentionally disabled until your protocol/commands are confirmed for the target environment.
    player_smoke: playerSmoke,

    admin_smoke: adminSmoke,
    web_smoke: webSmoke,

    // Convenience pack: combines core + web_smoke + admin_smoke + player_smoke.
    // Individual goals inside may be disabled (e.g. if MOTHER_BRAIN_WEB_BACKEND_HTTP_BASE is not set).
    all_smoke: [...corePack, ...webSmoke, ...adminSmoke, ...playerSmoke],
  };
}


function normalizePackIds(maybe: unknown): string[] {
  if (!maybe) return [];
  if (Array.isArray(maybe)) {
    return maybe
      .filter((x) => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof maybe === "string") {
    return maybe
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function mergeGoalsById(goals: GoalDefinition[]): GoalDefinition[] {
  const map = new Map<string, GoalDefinition>();
  for (const g of goals) {
    // later wins
    map.set(g.id, g);
  }
  return Array.from(map.values());
}

function validateMudExpectations(out: string, goal: { expectIncludes?: string; expectIncludesAll?: string[]; expectIncludesAny?: string[] }): string[] {
  const missing: string[] = [];
  if (goal.expectIncludes) {
    if (!out.includes(goal.expectIncludes)) missing.push(goal.expectIncludes);
  }
  if (Array.isArray(goal.expectIncludesAll) && goal.expectIncludesAll.length > 0) {
    for (const s of goal.expectIncludesAll) {
      if (!out.includes(s)) missing.push(s);
    }
  }
  if (Array.isArray(goal.expectIncludesAny) && goal.expectIncludesAny.length > 0) {
    const anyOk = goal.expectIncludesAny.some((s) => out.includes(s));
    if (!anyOk) missing.push(`any_of:${goal.expectIncludesAny.join("|")}`);
  }
  return missing;
}

export function resolveGoalPacks(
  packIds: string[],
  ctx?: { webBackendHttpBase?: string; webBackendAdminToken?: string; webBackendServiceToken?: string }
): { goals: GoalDefinition[]; unknown: string[] } {
  const packs = builtinGoalPacks(ctx);
  const out: GoalDefinition[] = [];
  const unknown: string[] = [];

  for (const raw of packIds) {
    const id = raw as GoalPackId;
    const pack = (packs as Record<string, GoalDefinition[]>)[id];
    if (!pack) {
      unknown.push(raw);
      continue;
    }
    out.push(...pack);
  }

  return { goals: mergeGoalsById(out), unknown };
}

export function createGoalsState(args: {
  filePath?: string;
  reportDir?: string;
  everyTicks: number;
  packIds?: string[] | string;
  webBackendHttpBase?: string;
  webBackendAdminToken?: string;
  webBackendServiceToken?: string;
}): GoalsState {
  const reportDir = args.reportDir;

  return {
    filePath: args.filePath,
    reportDir,
    everyTicks: args.everyTicks,
    packIds: normalizePackIds(args.packIds),
    webBackendHttpBase: args.webBackendHttpBase,
    webBackendAdminToken: args.webBackendAdminToken,
    webBackendServiceToken: args.webBackendServiceToken,
    lastRunIso: null,
    lastOk: null,
    lastSummary: null,
    lastFailingGoalsBySuite: undefined,
    inMemoryGoals: null,
  };
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeSuiteId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/g, "")
    .replace(/-$/g, "")
    .slice(0, 64);
}

function reportFilePathForSuite(state: GoalsState, suiteId: string): string | undefined {
  if (!state.reportDir) return undefined;
  const safe = sanitizeSuiteId(suiteId) || "suite";
  return path.resolve(state.reportDir, `mother-brain-goals-${safe}-${todayStamp()}.jsonl`);
}

export type GoalSuite = {
  id: string;
  source: "in_memory" | "file" | "packs" | "default";
  goals: GoalDefinition[];
};

export function getGoalSuites(
  state: GoalsState,
  deps?: Pick<GoalsDeps, "log">
): { suites: GoalSuite[]; unknownPacks: string[] } {
  // In-memory overrides everything.
  if (state.inMemoryGoals) {
    return { suites: [{ id: "custom", source: "in_memory", goals: state.inMemoryGoals }], unknownPacks: [] };
  }

  // File takes precedence if present and non-empty.
  if (state.filePath) {
    try {
      if (fs.existsSync(state.filePath)) {
        const parsed = safeReadJsonFile(state.filePath);
        const goals = normalizeGoals(parsed);
        if (goals.length > 0) {
          return { suites: [{ id: "custom", source: "file", goals }], unknownPacks: [] };
        }
      }
    } catch (e: unknown) {
      deps?.log?.("warn", "Failed to load goals file; falling back", {
        file: state.filePath,
        error: e instanceof Error ? e.message : String(e),
      });
      // fall back
    }
  }

  // Packs: each pack becomes its own suite/report.
  if (state.packIds.length > 0) {
    const packs = builtinGoalPacks({
      webBackendHttpBase: state.webBackendHttpBase,
      webBackendAdminToken: state.webBackendAdminToken,
      webBackendServiceToken: state.webBackendServiceToken,
    });
    const suites: GoalSuite[] = [];
    const unknown: string[] = [];

    for (const raw of state.packIds) {
      const id = raw as GoalPackId;
      const pack = (packs as Record<string, GoalDefinition[]>)[id];
      if (!pack) {
        unknown.push(raw);
        continue;
      }
      suites.push({ id: raw, source: "packs", goals: pack });
    }

    if (unknown.length > 0) deps?.log?.("warn", "Unknown goal pack ids ignored", { unknown });
    if (suites.length > 0) return { suites, unknownPacks: unknown };
  }

  // Default suite.
  return { suites: [{ id: "default", source: "default", goals: defaultGoals() }], unknownPacks: [] };
}

export function setInMemoryGoals(state: GoalsState, goals: GoalDefinition[] | null): void {
  state.inMemoryGoals = goals;
}

export function computeGoalsHealth(state: GoalsState, now: Date = new Date()): GoalsHealth {
  const lastRunIso = state.lastRunIso;
  const lastOk = state.lastOk;

  let ageSec: number | null = null;
  if (lastRunIso) {
    const t = Date.parse(lastRunIso);
    if (Number.isFinite(t)) {
      ageSec = Math.max(0, Math.floor((now.getTime() - t) / 1000));
    }
  }

  let status: GoalsHealth["status"] = "STALE";
  if (lastRunIso && lastOk === true) status = "OK";
  if (lastRunIso && lastOk === false) status = "FAIL";

  const okCount = state.lastSummary && typeof state.lastSummary.ok === "number" ? state.lastSummary.ok : null;
  const failCount = state.lastSummary && typeof state.lastSummary.fail === "number" ? state.lastSummary.fail : null;
  const totalCount = state.lastSummary && typeof state.lastSummary.total === "number" ? state.lastSummary.total : null;

  const bySuiteRaw = state.lastBySuite;
  const bySuite: Record<string, GoalsSuiteHealthSummary> = {};

  let suites: GoalsHealth["suites"] | undefined = undefined;
  if (bySuiteRaw && typeof bySuiteRaw === "object") {
    const entries = Object.entries(bySuiteRaw);
    const failingSuites = entries.filter(([, v]) => v?.ok === false).map(([k]) => k);

    suites = {
      total: entries.length,
      ok: entries.filter(([, v]) => v?.ok === true).length,
      fail: failingSuites.length,
      failingSuites,
    };

    for (const [suiteId, v] of entries) {
      const lastIso = v?.lastRunIso ?? null;
      let suiteAge: number | null = null;
      if (lastIso) {
        const t = Date.parse(lastIso);
        if (Number.isFinite(t)) suiteAge = Math.max(0, Math.floor((now.getTime() - t) / 1000));
      }

      let suiteStatus: GoalsSuiteHealthSummary["status"] = "STALE";
      if (lastIso && v?.ok === true) suiteStatus = "OK";
      if (lastIso && v?.ok === false) suiteStatus = "FAIL";

      const s = v?.summary;
      bySuite[suiteId] = {
        status: suiteStatus,
        ageSec: suiteAge,
        okCount: s && typeof s.ok === "number" ? s.ok : null,
        failCount: s && typeof s.fail === "number" ? s.fail : null,
        totalCount: s && typeof s.total === "number" ? s.total : null,
      };
    }
  }

  const failingGoalsBySuite = state.lastFailingGoalsBySuite;
  const failingGoals: GoalsFailingGoalPreview[] = [];
  if (failingGoalsBySuite && typeof failingGoalsBySuite === "object") {
    const suiteIds = Object.keys(failingGoalsBySuite);
    for (const suiteId of suiteIds) {
      const list = failingGoalsBySuite[suiteId];
      if (!Array.isArray(list)) continue;
      for (const r of list) {
        if (!r || typeof r !== "object") continue;
        failingGoals.push({
          suiteId,
          id: r.id,
          kind: r.kind,
          error: typeof r.error === "string" ? r.error : null,
          latencyMs: typeof r.latencyMs === "number" ? r.latencyMs : null,
          details: r.details && typeof r.details === "object" ? (r.details as Record<string, unknown>) : null,
        });
      }
    }
  }

  return {
    status,
    lastRunIso,
    ageSec,
    overall: {
      ok: lastOk,
      summary: state.lastSummary,
      okCount,
      failCount,
      totalCount,
      ...(failingGoals.length ? { failingGoals } : {}),
    },
    ...(suites ? { suites } : {}),
    ...(Object.keys(bySuite).length ? { bySuite } : {}),
  };
}

export function getActiveGoals(state: GoalsState, deps?: Pick<GoalsDeps, "log">): GoalDefinition[] {
  // Back-compat: return a single flattened list.
  const suites = getGoalSuites(state, deps).suites;
  if (suites.length === 1) return suites[0].goals;
  return mergeGoalsById(suites.flatMap((s) => s.goals));
}

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

function appendJsonl(filePath: string, obj: unknown): void {
  try {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, "utf-8");
  } catch {
    // ignore
  }
}


type FetchErrorInfo = {
  message: string;
  details?: Record<string, unknown>;
};

function describeFetchError(e: unknown): FetchErrorInfo {
  // Node's fetch (undici) often throws a TypeError("fetch failed") with a nested `cause`
  // containing the real network error (ECONNREFUSED, ENOTFOUND, etc).
  const err = e instanceof Error ? e : new Error(String(e));
  const anyErr = err as any;
  const cause = anyErr?.cause;
  const details: Record<string, unknown> = {
    name: err.name,
    message: err.message,
  };

  if (cause && typeof cause === "object") {
    details.cause = {
      name: (cause as any).name,
      message: (cause as any).message,
      code: (cause as any).code,
      errno: (cause as any).errno,
      syscall: (cause as any).syscall,
      address: (cause as any).address,
      port: (cause as any).port,
    };
  }

  // Build a human readable message.
  const code = (cause as any)?.code;
  const msg = code ? `${err.message} (${code})` : err.message;

  return { message: msg, details };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFetchError(details?: Record<string, unknown>): boolean {
  if (!details) return false;
  const cause = (details as any).cause;
  const code = cause?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "EAI_AGAIN";
}

function isTransientHttpStatus(status?: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isTransientWsError(err?: string): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return (
    s.includes("timeout") ||
    s.includes("timed out") ||
    s.includes("not connected") ||
    s.includes("disconnected") ||
    s.includes("closed") ||
    s.includes("connecting") ||
    s.includes("econnrefused") ||
    s.includes("econnreset") ||
    s.includes("epipe") ||
    s.includes("socket")
  );
}

async function httpGet(args: {
  url: string;
  timeoutMs: number;
  expectStatus?: number;
  expectIncludes?: string;
  maxBodyBytes?: number;
  retries?: number;
  retryDelayMs?: number;
}): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
  errorDetails?: Record<string, unknown>;
  bodyPreview?: string;
}> {
  const retries = Math.max(0, Math.min(10, args.retries ?? 2));
  const baseDelayMs = Math.max(0, Math.min(10_000, args.retryDelayMs ?? 200));

  const attemptOnce = async (): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
    errorDetails?: Record<string, unknown>;
    bodyPreview?: string;
  }> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), args.timeoutMs);

    try {
      const res = await fetch(args.url, { method: "GET", signal: ctrl.signal });
      const status = res.status;

      const statusOk = typeof args.expectStatus === "number" ? status === args.expectStatus : res.ok;

      const expectIncludes =
        typeof args.expectIncludes === "string" && args.expectIncludes.length > 0 ? args.expectIncludes : null;
      if (!expectIncludes) {
        return { ok: statusOk, status };
      }

      const maxBodyBytes = typeof args.maxBodyBytes === "number" && args.maxBodyBytes > 0 ? args.maxBodyBytes : 4096;
      const txt = await res.text();
      const preview = txt.length > maxBodyBytes ? `${txt.slice(0, maxBodyBytes)}…` : txt;
      const bodyOk = preview.includes(expectIncludes);

      return {
        ok: statusOk && bodyOk,
        status,
        bodyPreview: preview,
        error: statusOk && !bodyOk ? `missing substring: ${expectIncludes}` : undefined,
      };
    } catch (e: unknown) {
      const info = describeFetchError(e);
      return { ok: false, error: info.message, errorDetails: info.details };
    } finally {
      clearTimeout(t);
    }
  };

  let last: Awaited<ReturnType<typeof attemptOnce>> | null = null;

  for (let i = 0; i <= retries; i += 1) {
    last = await attemptOnce();
    if (last.ok) return last;

    const transient = isTransientFetchError(last.errorDetails) || isTransientHttpStatus(last.status);
    if (!transient || i === retries) break;

    const delay = Math.floor(baseDelayMs * Math.pow(2, i) + Math.random() * 50);
    await sleep(delay);
  }

  return last ?? { ok: false, error: "unknown http_get failure" };
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualJson(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!(k in b)) return false;
      if (!deepEqualJson((a as any)[k], (b as any)[k])) return false;
    }
    return true;
  }

  return false;
}

function subsetMatch(expected: unknown, actual: unknown): boolean {
  // expected must be contained within actual (deep partial match)
  if (expected === undefined) return true;
  if (expected === null || typeof expected !== "object") return deepEqualJson(expected, actual);

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    // For arrays, require same length and element-wise subset (conservative).
    if (expected.length !== actual.length) return false;
    for (let i = 0; i < expected.length; i += 1) {
      if (!subsetMatch(expected[i], (actual as any)[i])) return false;
    }
    return true;
  }

  if (!isPlainObject(actual) || !isPlainObject(expected)) return false;
  for (const [k, v] of Object.entries(expected)) {
    if (!(k in actual)) return false;
    if (!subsetMatch(v, (actual as any)[k])) return false;
  }
  return true;
}

function getByDotPath(root: unknown, dotPath: string): unknown {
  const parts = dotPath
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);

  let cur: any = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;

    // numeric array index
    if (/^\d+$/.test(part)) {
      const idx = Number(part);
      if (!Array.isArray(cur)) return undefined;
      cur = cur[idx];
      continue;
    }

    if (typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

async function httpJson(args: {
  url: string;
  timeoutMs: number;
  requestHeaders?: Record<string, string>;
  expectStatus?: number;
  retries?: number;
  retryDelayMs?: number;
  expectPath?: string;
  expectValue?: unknown;
  expectSubset?: unknown;
  expectJson?: unknown;
  maxBodyBytes?: number;
  maxPreviewBytes?: number;
}): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
  errorDetails?: Record<string, unknown>;
  bodyPreview?: string;
  extracted?: unknown;
}> {
  const retries = Math.max(0, Math.min(10, args.retries ?? 2));
  const baseDelayMs = Math.max(0, Math.min(10_000, args.retryDelayMs ?? 200));

  const attemptOnce = async (): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
    errorDetails?: Record<string, unknown>;
    bodyPreview?: string;
    extracted?: unknown;
  }> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), args.timeoutMs);
    try {
      const res = await fetch(args.url, { method: "GET", signal: ctrl.signal, headers: args.requestHeaders });
      const status = res.status;
      const statusOk = typeof args.expectStatus === "number" ? status === args.expectStatus : res.ok;

      const maxBodyBytes = typeof args.maxBodyBytes === "number" && args.maxBodyBytes > 0 ? args.maxBodyBytes : 16384;
      const maxPreviewBytes =
        typeof args.maxPreviewBytes === "number" && args.maxPreviewBytes > 0 ? args.maxPreviewBytes : 4096;

      const txt = await res.text();
      const capped = txt.length > maxBodyBytes ? txt.slice(0, maxBodyBytes) : txt;
      const preview = capped.length > maxPreviewBytes ? `${capped.slice(0, maxPreviewBytes)}…` : capped;

      let json: unknown;
      try {
        json = JSON.parse(capped);
      } catch (e: unknown) {
        return {
          ok: false,
          status,
          bodyPreview: preview,
          error: `invalid json: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      const checks: { ok: boolean; err?: string; extracted?: unknown }[] = [];

      if (typeof args.expectPath === "string" && args.expectPath.trim().length > 0) {
        const v = getByDotPath(json, args.expectPath.trim());
        checks.push({
          ok: deepEqualJson(v, args.expectValue),
          err: `path mismatch: ${args.expectPath}`,
          extracted: v,
        });
      }

      if (args.expectSubset && typeof args.expectSubset === "object") {
        checks.push({ ok: subsetMatch(args.expectSubset, json), err: "subset mismatch" });
      }

      if ("expectJson" in args && args.expectJson !== undefined) {
        checks.push({ ok: deepEqualJson(args.expectJson, json), err: "json mismatch" });
      }

      const checksOk = checks.every((c) => c.ok);
      const extracted = checks.find((c) => c.extracted !== undefined)?.extracted;

      const ok = statusOk && checksOk;
      return {
        ok,
        status,
        bodyPreview: preview,
        extracted,
        error: ok
          ? undefined
          : !statusOk
            ? `status ${status}`
            : checks.find((c) => !c.ok)?.err ?? "json expectation failed",
      };
    } catch (e: unknown) {
      const info = describeFetchError(e);
      return { ok: false, error: info.message, errorDetails: info.details };
    } finally {
      clearTimeout(t);
    }
  };

  let last: Awaited<ReturnType<typeof attemptOnce>> | null = null;

  for (let i = 0; i <= retries; i += 1) {
    last = await attemptOnce();
    if (last.ok) return last;

    const transient = isTransientFetchError(last.errorDetails) || isTransientHttpStatus(last.status);
    if (!transient || i === retries) break;

    const delay = Math.floor(baseDelayMs * Math.pow(2, i) + Math.random() * 50);
    await sleep(delay);
  }

  return last ?? { ok: false, error: "unknown http_json failure" };
}

async function httpPostJson(args: {
  url: string;
  timeoutMs: number;
  requestJson: unknown;
  requestHeaders?: Record<string, string>;
  expectStatus?: number;
  retries?: number;
  retryDelayMs?: number;
  expectPath?: string;
  expectValue?: unknown;
  expectSubset?: unknown;
  expectJson?: unknown;
  maxBodyBytes?: number;
  maxPreviewBytes?: number;
}): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
  errorDetails?: Record<string, unknown>;
  bodyPreview?: string;
  extracted?: unknown;
}> {
  const retries = Math.max(0, Math.min(10, args.retries ?? 2));
  const baseDelayMs = Math.max(0, Math.min(10_000, args.retryDelayMs ?? 200));

  const attemptOnce = async (): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
    errorDetails?: Record<string, unknown>;
    bodyPreview?: string;
    extracted?: unknown;
  }> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), args.timeoutMs);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...(args.requestHeaders ?? {}),
      };

      const res = await fetch(args.url, {
        method: "POST",
        signal: ctrl.signal,
        headers,
        body: JSON.stringify(args.requestJson ?? null),
      });

      const status = res.status;
      const statusOk = typeof args.expectStatus === "number" ? status === args.expectStatus : res.ok;

      const wantsJson =
        (typeof args.expectPath === "string" && args.expectPath.trim().length > 0) ||
        (args.expectSubset && typeof args.expectSubset === "object") ||
        ("expectJson" in args && args.expectJson !== undefined);

      if (!wantsJson) return { ok: statusOk, status };

      const maxBodyBytes = typeof args.maxBodyBytes === "number" && args.maxBodyBytes > 0 ? args.maxBodyBytes : 16384;
      const maxPreviewBytes =
        typeof args.maxPreviewBytes === "number" && args.maxPreviewBytes > 0 ? args.maxPreviewBytes : 4096;

      const txt = await res.text();
      const capped = txt.length > maxBodyBytes ? txt.slice(0, maxBodyBytes) : txt;
      const preview = capped.length > maxPreviewBytes ? `${capped.slice(0, maxPreviewBytes)}…` : capped;

      let json: unknown;
      try {
        json = JSON.parse(capped);
      } catch (e: unknown) {
        return {
          ok: false,
          status,
          bodyPreview: preview,
          error: `invalid json: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      const checks: { ok: boolean; err?: string; extracted?: unknown }[] = [];

      if (typeof args.expectPath === "string" && args.expectPath.trim().length > 0) {
        const v = getByDotPath(json, args.expectPath.trim());
        checks.push({
          ok: deepEqualJson(v, args.expectValue),
          err: `path mismatch: ${args.expectPath}`,
          extracted: v,
        });
      }

      if (args.expectSubset && typeof args.expectSubset === "object") {
        checks.push({ ok: subsetMatch(args.expectSubset, json), err: "subset mismatch" });
      }

      if ("expectJson" in args && args.expectJson !== undefined) {
        checks.push({ ok: deepEqualJson(args.expectJson, json), err: "json mismatch" });
      }

      const checksOk = checks.every((c) => c.ok);
      const extracted = checks.find((c) => c.extracted !== undefined)?.extracted;

      const ok = statusOk && checksOk;
      return {
        ok,
        status,
        bodyPreview: preview,
        extracted,
        error: ok
          ? undefined
          : !statusOk
            ? `status ${status}`
            : checks.find((c) => !c.ok)?.err ?? "json expectation failed",
      };
    } catch (e: unknown) {
      const info = describeFetchError(e);
      return { ok: false, error: info.message, errorDetails: info.details };
    } finally {
      clearTimeout(t);
    }
  };

  let last: Awaited<ReturnType<typeof attemptOnce>> | null = null;

  for (let i = 0; i <= retries; i += 1) {
    last = await attemptOnce();
    if (last.ok) return last;

    const transient = isTransientFetchError(last.errorDetails) || isTransientHttpStatus(last.status);
    if (!transient || i === retries) break;

    const delay = Math.floor(baseDelayMs * Math.pow(2, i) + Math.random() * 50);
    await sleep(delay);
  }

  return last ?? { ok: false, error: "unknown http_post_json failure" };
}


export async function runGoalsOnce(
  state: GoalsState,
  deps: GoalsDeps,
  tick: number,
  opts?: { suiteId?: string; goals?: GoalDefinition[]; reportFilePath?: string }
): Promise<GoalRunReport> {
  const goals = opts?.goals ?? getActiveGoals(state, deps);
  const ts = deps.nowIso();

  const results: GoalRunResult[] = [];
  let okCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (const goal of goals) {
    if (goal.enabled === false) {
      skippedCount += 1;
      results.push({ id: goal.id, kind: goal.kind, ok: true, details: { skipped: true } });
      continue;
    }

    const start = Date.now();

    if (goal.kind === "db_table_exists") {
      const table = goal.table;
      if (!table) {
        failCount += 1;
        results.push({
          id: goal.id,
          kind: goal.kind,
          ok: false,
          latencyMs: Date.now() - start,
          error: "missing table name",
        });
        continue;
      }

      try {
        const res = await deps.dbQuery<{ exists: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) as exists",
          [table]
        );

        if (!res) {
          failCount += 1;
          results.push({
            id: goal.id,
            kind: goal.kind,
            ok: false,
            latencyMs: Date.now() - start,
            error: "db disabled",
          });
          continue;
        }

        const exists = Boolean(res.rows?.[0]?.exists);
        if (exists) okCount += 1;
        else failCount += 1;

        results.push({
          id: goal.id,
          kind: goal.kind,
          ok: exists,
          latencyMs: Date.now() - start,
          details: { table },
        });
      } catch (e: unknown) {
        failCount += 1;
        results.push({
          id: goal.id,
          kind: goal.kind,
          ok: false,
          latencyMs: Date.now() - start,
          error: e instanceof Error ? e.message : String(e),
          details: { table },
        });
      }
      continue;
    }

    if (goal.kind === "db_wave_budget_breaches") {
      const max = goal.maxBreaches ?? 0;
      const wb = deps.waveBudget;
      if (!wb) {
        skippedCount += 1;
        results.push({
          id: goal.id,
          kind: goal.kind,
          ok: true,
          latencyMs: Date.now() - start,
          details: { skipped: true, reason: "no wave budget snapshot" },
        });
        continue;
      }

      if (!wb.ok) {
        failCount += 1;
        results.push({
          id: goal.id,
          kind: goal.kind,
          ok: false,
          latencyMs: Date.now() - start,
          error: wb.reason,
        });
        continue;
      }

      const breaches = Array.isArray(wb.breaches) ? wb.breaches : [];
      const ok = breaches.length <= max;
      if (ok) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok,
        latencyMs: Date.now() - start,
        details: { breaches: breaches.length, maxBreaches: max },
      });
      continue;
    }

    if (goal.kind === "ws_connected") {
      // If WS is disabled, treat as skip.
      if (deps.wsState === "disabled") {
        skippedCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: true, details: { skipped: true } });
        continue;
      }

      const ok = deps.wsState === "open";
      if (ok) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok,
        latencyMs: Date.now() - start,
        details: { state: deps.wsState },
      });
      continue;
    }

    if (goal.kind === "ws_mud") {
      // If WS is disabled, treat as skip.
      if (deps.wsState === "disabled") {
        skippedCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: true, details: { skipped: true } });
        continue;
      }

      const command = goal.command;
      if (!command) {
        failCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: false, error: "missing command" });
        continue;
      }

      if (!deps.wsMudCommand) {
        failCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: false, error: "ws mud command not available" });
        continue;
      }

      const timeoutMs = goal.timeoutMs ?? 2500;
      const retries = Math.max(0, Math.min(10, goal.retries ?? 2));
      const baseDelayMs = Math.max(0, Math.min(10_000, goal.retryDelayMs ?? 200));

      let res: { ok: boolean; output?: string; error?: string } = { ok: false, error: "not attempted" };
      let out = "";
      let ok = false;

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        res = await deps.wsMudCommand(command, timeoutMs);
        ok = res.ok;
        out = res.output ?? "";

        // If the command itself succeeded, we can validate expectations.
        if (ok) break;

        // If it failed, retry only on transient WS failures (startup order, reconnect windows, etc).
        const transient = isTransientWsError(res.error);
        if (!transient || attempt === retries) break;

        const jitter = Math.floor(Math.random() * 25);
        const delay = Math.min(10_000, baseDelayMs * Math.pow(2, attempt) + jitter);
        await sleep(delay);
      }

      const missing = ok ? validateMudExpectations(out, goal) : [];
      if (missing.length > 0) ok = false;

      // If expectations failed (not a transport issue), do not retry – this is a real contract mismatch.

      if (ok) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok,
        latencyMs: Date.now() - start,
        error: ok
          ? undefined
          : res.error ?? (missing.length > 0 ? `missing expectation: ${missing.join(', ')}` : "failed"),
        details: {
          command,
          expectIncludes: goal.expectIncludes,
          expectIncludesAny: goal.expectIncludesAny,
          expectIncludesAll: goal.expectIncludesAll,
          outputPreview: out.length > 400 ? `${out.slice(0, 400)}…` : out,
        },
      });
      continue;
    }

    if (goal.kind === "ws_mud_script") {
      // If WS is disabled, treat as skip.
      if (deps.wsState === "disabled") {
        skippedCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: true, details: { skipped: true } });
        continue;
      }

      const script = Array.isArray(goal.script) ? goal.script : [];
      if (script.length === 0) {
        failCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: false, error: "missing script" });
        continue;
      }

      if (!deps.wsMudCommand) {
        failCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: false, error: "ws mud command not available" });
        continue;
      }

      const retries = Math.max(0, Math.min(10, goal.retries ?? 2));
      const baseDelayMs = Math.max(0, Math.min(10_000, goal.retryDelayMs ?? 200));
      const stepDelayMs = Math.max(0, Math.min(10_000, goal.scriptDelayMs ?? 0));
      const stopOnFail = goal.scriptStopOnFail !== false;

      const stepReports: any[] = [];
      let overallOk = true;

      for (let i = 0; i < script.length; i += 1) {
        const step = script[i];
        const cmd = String(step.command ?? "").trim();
        if (!cmd) {
          overallOk = false;
          stepReports.push({
            index: i,
            command: "",
            ok: false,
            error: "missing command",
          });
          if (stopOnFail) break;
          continue;
        }

        const timeoutMs = step.timeoutMs ?? goal.timeoutMs ?? 2500;

        let res: { ok: boolean; output?: string; error?: string } = { ok: false, error: "not attempted" };
        let out = "";
        let ok = false;

        for (let attempt = 0; attempt <= retries; attempt += 1) {
          res = await deps.wsMudCommand(cmd, timeoutMs);
          ok = res.ok;
          out = res.output ?? "";

          if (ok) break;

          const transient = isTransientWsError(res.error);
          if (!transient || attempt === retries) break;

          const jitter = Math.floor(Math.random() * 25);
          const delay = Math.min(10_000, baseDelayMs * Math.pow(2, attempt) + jitter);
          await sleep(delay);
        }

        const missing = ok ? validateMudExpectations(out, step) : [];
        if (missing.length > 0) ok = false;

        stepReports.push({
          index: i,
          command: cmd,
          ok,
          error: ok
            ? undefined
            : res.error ?? (missing.length > 0 ? `missing expectation: ${missing.join(", ")}` : "failed"),
          outputPreview: out.length > 220 ? `${out.slice(0, 220)}…` : out,
          expectIncludes: step.expectIncludes,
          expectIncludesAny: step.expectIncludesAny,
          expectIncludesAll: step.expectIncludesAll,
        });

        if (!ok) {
          overallOk = false;
          if (stopOnFail) break;
        }

        if (stepDelayMs > 0 && i < script.length - 1) {
          await sleep(stepDelayMs);
        }
      }

      if (overallOk) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok: overallOk,
        latencyMs: Date.now() - start,
        error: overallOk ? undefined : "script failed",
        details: {
          steps: stepReports,
        },
      });
      continue;
    }

    if (goal.kind === "http_get") {
      const url = goal.url;
      if (!url) {
        failCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: false, error: "missing url" });
        continue;
      }

      const expectStatus = goal.expectStatus;
      const timeoutMs = goal.timeoutMs ?? 2000;

      const res = await httpGet({
        url,
        timeoutMs,
        expectStatus,
        expectIncludes: goal.expectIncludes,
        retries: goal.retries,
        retryDelayMs: goal.retryDelayMs,
      });
      const ok = res.ok;
      if (ok) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok,
        latencyMs: Date.now() - start,
        error: ok ? undefined : res.error ?? `status ${res.status ?? "unknown"}`,
        details: {
          url,
          status: res.status,
          expectStatus,
          expectIncludes: goal.expectIncludes,
          bodyPreview: res.bodyPreview,
          fetchError: res.errorDetails,
          hint: res.ok
            ? undefined
            : res.errorDetails
              ? "Fetch failed: verify the target service is running and reachable from Mother Brain (base URL / network namespace)."
              : res.status === 401 || (res.bodyPreview ?? "").includes("missing_token")
                ? "401 missing_token: admin endpoints require auth. Set MOTHER_BRAIN_WEB_BACKEND_ADMIN_TOKEN (or PW_ADMIN_TOKEN) for human auth, or MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN for daemon auth."
                : undefined,
        },
      });
      continue;
    }

    
    if (goal.kind === "http_json") {
      const url = goal.url;
      if (!url) {
        failCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: false, error: "missing url" });
        continue;
      }

      const timeoutMs = goal.timeoutMs ?? 2000;
      const res = await httpJson({
        url,
        timeoutMs,
        requestHeaders: (goal as any).requestHeaders,
        expectStatus: goal.expectStatus,
        retries: goal.retries,
        retryDelayMs: goal.retryDelayMs,
        expectPath: goal.expectPath,
        expectValue: goal.expectValue,
        expectSubset: goal.expectSubset,
        expectJson: goal.expectJson,
      });

      const ok = res.ok;
      if (ok) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok,
        latencyMs: Date.now() - start,
        error: ok ? undefined : res.error ?? `status ${res.status ?? "unknown"}`,
        details: {
          url,
          status: res.status,
          expectStatus: goal.expectStatus,
          expectPath: goal.expectPath,
          expectValue: goal.expectValue,
          expectSubset: goal.expectSubset,
          expectJson: goal.expectJson,
          extracted: res.extracted,
          bodyPreview: res.bodyPreview,
          fetchError: res.errorDetails,
          hint: res.ok
            ? undefined
            : res.errorDetails
              ? "Fetch failed: verify the target service is running and reachable from Mother Brain (base URL / network namespace)."
              : res.status === 401 || (res.bodyPreview ?? "").includes("missing_token")
                ? "401 missing_token: admin endpoints require auth. Set MOTHER_BRAIN_WEB_BACKEND_ADMIN_TOKEN (or PW_ADMIN_TOKEN) for human auth, or MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN for daemon auth."
                : undefined,
        },
      });
      continue;
    }


    if (goal.kind === "http_post_json") {
      const url = goal.url;
      if (!url) {
        failCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: false, error: "missing url" });
        continue;
      }

      const timeoutMs = goal.timeoutMs ?? 2000;
      const req = "requestJson" in goal ? (goal as any).requestJson : undefined;
      if (req === undefined) {
        failCount += 1;
        results.push({ id: goal.id, kind: goal.kind, ok: false, error: "missing requestJson" });
        continue;
      }

      const res = await httpPostJson({
        url,
        timeoutMs,
        requestJson: req,
        requestHeaders: (goal as any).requestHeaders,
        expectStatus: goal.expectStatus,
        retries: goal.retries,
        retryDelayMs: goal.retryDelayMs,
        expectPath: goal.expectPath,
        expectValue: goal.expectValue,
        expectSubset: goal.expectSubset,
        expectJson: goal.expectJson,
      });

      const ok = res.ok;
      if (ok) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok,
        latencyMs: Date.now() - start,
        error: ok ? undefined : res.error ?? `status ${res.status ?? "unknown"}`,
        details: {
          url,
          status: res.status,
          expectStatus: goal.expectStatus,
          expectPath: goal.expectPath,
          expectValue: goal.expectValue,
          expectSubset: goal.expectSubset,
          expectJson: goal.expectJson,
          extracted: res.extracted,
          bodyPreview: res.bodyPreview,
          fetchError: res.errorDetails,
          hint: ok
            ? undefined
            : res.errorDetails
              ? "Fetch failed: verify the target service is running and reachable from Mother Brain (base URL / network namespace)."
              : res.status === 401 || (res.bodyPreview ?? "").includes("missing_token")
                ? "401 missing_token: admin endpoints require auth. Set MOTHER_BRAIN_WEB_BACKEND_ADMIN_TOKEN (or PW_ADMIN_TOKEN) for human auth, or MOTHER_BRAIN_WEB_BACKEND_SERVICE_TOKEN for daemon auth."
                : undefined,
        },
      });
      continue;
    }


// Unknown kind => fail (explicit, so we notice typos quickly)
    failCount += 1;
    results.push({ id: goal.id, kind: goal.kind, ok: false, error: `unknown goal kind: ${goal.kind}` });
  }

  const report: GoalRunReport = {
    ts,
    tick,
    ok: failCount === 0,
    results,
    summary: {
      total: results.length,
      ok: okCount,
      fail: failCount,
      skipped: skippedCount,
    },
  };

  state.lastRunIso = ts;
  state.lastOk = report.ok;
  state.lastSummary = report.summary;

  const reportFile = opts?.reportFilePath ?? (opts?.suiteId ? reportFilePathForSuite(state, opts.suiteId) : undefined);
  if (reportFile) appendJsonl(reportFile, report);

  // Also emit a compact log line so PW_FILELOG captures it.
  deps.log(report.ok ? "info" : "warn", "Goals run", {
    tick,
    ok: report.ok,
    summary: report.summary,
    reportFile,
    packs: state.packIds,
    suiteId: opts?.suiteId,
  });

  return report;
}

export async function runGoalSuites(
  state: GoalsState,
  deps: GoalsDeps,
  tick: number
): Promise<{ ok: boolean; bySuite: Record<string, GoalRunReport>; overall: GoalRunReport }> {
  const { suites } = getGoalSuites(state, deps);
  const bySuite: Record<string, GoalRunReport> = {};

  // Capture failing goal previews (capped) for UI/snapshot surfacing.
  const failingBySuite: Record<string, GoalRunResult[]> = {};

  let overallOk = true;
  let total = 0;
  let okCount = 0;
  let fail = 0;
  let skipped = 0;

  for (const suite of suites) {
    const report = await runGoalsOnce(state, deps, tick, {
      suiteId: suite.id,
      goals: suite.goals,
      reportFilePath: reportFilePathForSuite(state, suite.id),
    });
    bySuite[suite.id] = report;

    const failing = report.results.filter((r) => r && r.ok === false);
    if (failing.length) failingBySuite[suite.id] = failing.slice(0, 10);
    overallOk = overallOk && report.ok;
    total += report.summary.total;
    okCount += report.summary.ok;
    fail += report.summary.fail;
    skipped += report.summary.skipped;
  }

  const overall: GoalRunReport = {
    ts: deps.nowIso(),
    tick,
    ok: overallOk,
    results: [],
    summary: { total, ok: okCount, fail, skipped },
  };

  state.lastBySuite = Object.fromEntries(
    Object.entries(bySuite).map(([id, r]) => [id, { lastRunIso: r.ts, ok: r.ok, summary: r.summary }])
  );

  state.lastFailingGoalsBySuite = Object.keys(failingBySuite).length ? failingBySuite : undefined;

  // Keep the legacy fields as the overall view.
  state.lastRunIso = overall.ts;
  state.lastOk = overall.ok;
  state.lastSummary = overall.summary;

  return { ok: overallOk, bySuite, overall };
}
