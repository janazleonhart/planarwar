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

  // Optional maximum acceptable latency for this step (ms). Overrides goal.maxLatencyMs when set.
  maxLatencyMs?: number;

  // If true, a failure in this step will not fail the overall script.
  // The step will be reported with optionalFailed metadata.
  optional?: boolean;

  // Optional per-step retry behavior (overrides goal-level retries when set).
  retries?: number;
  retryDelayMs?: number;

  // Optional per-step delay after a successful step (ms). If unset, goal.scriptDelayMs applies between steps.
  delayAfterMs?: number;
  expectIncludes?: string;
  expectIncludesAny?: string[];
  expectIncludesAll?: string[];

  // Negative expectations: fail if output contains/matches these.
  rejectIncludes?: string;
  rejectIncludesAny?: string[];

  // Optional regex expectations (string form; supports /pattern/flags or plain pattern).
  expectRegex?: string;
  expectRegexAny?: string[];
  expectRegexAll?: string[];

  // Optional regex rejections (string form; supports /pattern/flags or plain pattern).
  rejectRegex?: string;
  rejectRegexAny?: string[];
  rejectRegexAll?: string[];

  // Optional stop condition: if output matches, the script ends early as OK.
  // Useful for "do X if available, else stop cleanly" flows.
  stopOkIfIncludes?: string;
  stopOkIfIncludesAny?: string[];

  stopOkIfRegex?: string;
  stopOkIfRegexAny?: string[];
  stopOkIfRegexAll?: string[];

  // Optional capture: extract a value from output into a named variable for later steps.
  // captureRegex supports /pattern/flags or plain pattern. If captureGroup is not set, group 1 is used when present, else group 0.
  captureRegex?: string;
  captureVar?: string;
  captureGroup?: number;
};

export type GoalDefinition = {
  id: string;
  kind: GoalKind;
  enabled?: boolean;

  // Optional service token role requirement (used for admin smoke HTTP goals).
  // If omitted, we default to "readonly".
  serviceRole?: "readonly" | "editor" | "root";

  // db_table_exists
  table?: string;

  // http_get
  url?: string;
  expectStatus?: number;
  timeoutMs?: number;


  // Optional maximum acceptable latency for the goal (ms). If exceeded, the goal fails even if checks pass.
  // For ws_mud_script, steps may override via step.maxLatencyMs.
  maxLatencyMs?: number;

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

  // Negative expectations: fail if output contains/matches these.
  rejectIncludes?: string;
  rejectIncludesAny?: string[];

  // Optional regex expectations (string form; supports /pattern/flags or plain pattern).
  expectRegex?: string;
  expectRegexAny?: string[];
  expectRegexAll?: string[];

  // Optional regex rejections (string form; supports /pattern/flags or plain pattern).
  rejectRegex?: string;
  rejectRegexAny?: string[];
  rejectRegexAll?: string[];

  // ws_mud_script
  script?: WsMudScriptStep[];
  scriptDelayMs?: number;
  scriptStopOnFail?: boolean;

  // Optional initial template variables for ws_mud_script.
  // These are merged into the script's runtime vars before executing steps.
  // Values must be strings.
  scriptVars?: Record<string, string>;

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
  webBackendServiceToken?: string; // legacy single-token
  webBackendServiceTokenReadonly?: string;
  webBackendServiceTokenEditor?: string;

  mmoBackendHttpBase?: string;
  mmoBackendServiceToken?: string; // legacy single-token
  mmoBackendServiceTokenReadonly?: string;
  mmoBackendServiceTokenEditor?: string;

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
      maxLatencyMs: typeof (o as any).maxLatencyMs === "number" ? (o as any).maxLatencyMs : undefined,
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

      rejectIncludes: typeof (o as any).rejectIncludes === "string" ? ((o as any).rejectIncludes as string) : undefined,
      rejectIncludesAny: Array.isArray((o as any).rejectIncludesAny)
        ? (o as any).rejectIncludesAny.filter((x: any) => typeof x === "string")
        : undefined,
      expectRegex: typeof (o as any).expectRegex === "string" ? ((o as any).expectRegex as string) : undefined,
      expectRegexAny: Array.isArray((o as any).expectRegexAny)
        ? (o as any).expectRegexAny.filter((x: any) => typeof x === "string")
        : undefined,
      expectRegexAll: Array.isArray((o as any).expectRegexAll)
        ? (o as any).expectRegexAll.filter((x: any) => typeof x === "string")
        : undefined,

      rejectRegex: typeof (o as any).rejectRegex === "string" ? ((o as any).rejectRegex as string) : undefined,
      rejectRegexAny: Array.isArray((o as any).rejectRegexAny)
        ? (o as any).rejectRegexAny.filter((x: any) => typeof x === "string")
        : undefined,
      rejectRegexAll: Array.isArray((o as any).rejectRegexAll)
        ? (o as any).rejectRegexAll.filter((x: any) => typeof x === "string")
        : undefined,
      script: Array.isArray((o as any).script)
        ? (o as any).script
            .filter((s: any) => s && typeof s === "object")
            .map((s: any) => ({
              command: String(s.command ?? ""),
              timeoutMs: typeof s.timeoutMs === "number" ? s.timeoutMs : undefined,

              maxLatencyMs: typeof s.maxLatencyMs === "number" ? s.maxLatencyMs : undefined,

              optional: typeof s.optional === "boolean" ? s.optional : undefined,

              // Per-step retry/delay overrides
              retries: typeof s.retries === "number" ? s.retries : undefined,
              retryDelayMs: typeof s.retryDelayMs === "number" ? s.retryDelayMs : undefined,
              delayAfterMs: typeof s.delayAfterMs === "number" ? s.delayAfterMs : undefined,

              expectIncludes: typeof s.expectIncludes === "string" ? s.expectIncludes : undefined,
              expectIncludesAny: Array.isArray(s.expectIncludesAny)
                ? s.expectIncludesAny.filter((x: any) => typeof x === "string")
                : undefined,
              expectIncludesAll: Array.isArray(s.expectIncludesAll)
                ? s.expectIncludesAll.filter((x: any) => typeof x === "string")
                : undefined,

              rejectIncludes: typeof s.rejectIncludes === "string" ? (s.rejectIncludes as string) : undefined,
              rejectIncludesAny: Array.isArray(s.rejectIncludesAny)
                ? s.rejectIncludesAny.filter((x: any) => typeof x === "string")
                : undefined,
              expectRegex: typeof s.expectRegex === "string" ? (s.expectRegex as string) : undefined,
              expectRegexAny: Array.isArray(s.expectRegexAny)
                ? s.expectRegexAny.filter((x: any) => typeof x === "string")
                : undefined,
              expectRegexAll: Array.isArray(s.expectRegexAll)
                ? s.expectRegexAll.filter((x: any) => typeof x === "string")
                : undefined,

              rejectRegex: typeof s.rejectRegex === "string" ? (s.rejectRegex as string) : undefined,
              rejectRegexAny: Array.isArray(s.rejectRegexAny)
                ? s.rejectRegexAny.filter((x: any) => typeof x === "string")
                : undefined,
              rejectRegexAll: Array.isArray(s.rejectRegexAll)
                ? s.rejectRegexAll.filter((x: any) => typeof x === "string")
                : undefined,
              captureRegex: typeof s.captureRegex === "string" ? (s.captureRegex as string) : undefined,
              captureVar: typeof s.captureVar === "string" ? (s.captureVar as string) : undefined,
              captureGroup: typeof s.captureGroup === "number" ? (s.captureGroup as number) : undefined,
              stopOkIfIncludes: typeof (s as any).stopOkIfIncludes === "string" ? ((s as any).stopOkIfIncludes as string) : undefined,
              stopOkIfIncludesAny: Array.isArray((s as any).stopOkIfIncludesAny)
                ? (s as any).stopOkIfIncludesAny.filter((x: any) => typeof x === "string")
                : undefined,
              stopOkIfRegex: typeof (s as any).stopOkIfRegex === "string" ? ((s as any).stopOkIfRegex as string) : undefined,
              stopOkIfRegexAny: Array.isArray((s as any).stopOkIfRegexAny)
                ? (s as any).stopOkIfRegexAny.filter((x: any) => typeof x === "string")
                : undefined,
              stopOkIfRegexAll: Array.isArray((s as any).stopOkIfRegexAll)
                ? (s as any).stopOkIfRegexAll.filter((x: any) => typeof x === "string")
                : undefined,

            }))
            .filter((s: any) => typeof s.command === "string" && s.command.trim().length > 0)
        : undefined,
      scriptDelayMs: typeof (o as any).scriptDelayMs === "number" ? (o as any).scriptDelayMs : undefined,
      scriptStopOnFail: typeof (o as any).scriptStopOnFail === "boolean" ? (o as any).scriptStopOnFail : undefined,
      scriptVars:
        (o as any).scriptVars && typeof (o as any).scriptVars === "object" && !Array.isArray((o as any).scriptVars)
          ? Object.fromEntries(
              Object.entries((o as any).scriptVars as Record<string, unknown>)
                .filter(([k, v]) => typeof k === "string" && typeof v === "string")
                .map(([k, v]) => [k, v as string])
            )
          : undefined,
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
  | "playtester"
  | "admin_smoke"
  | "web_smoke"
  | "all_smoke";

export function builtinGoalPacks(ctx?: {
  webBackendHttpBase?: string;
  webBackendAdminToken?: string;
  webBackendServiceToken?: string;
  webBackendServiceTokenReadonly?: string;
  webBackendServiceTokenEditor?: string;

  mmoBackendHttpBase?: string;
  mmoBackendServiceToken?: string;
  mmoBackendServiceTokenReadonly?: string;
  mmoBackendServiceTokenEditor?: string;
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
  const legacyServiceToken = ctx?.webBackendServiceToken;
  const serviceTokenReadonly = ctx?.webBackendServiceTokenReadonly ?? legacyServiceToken;
  const serviceTokenEditor = ctx?.webBackendServiceTokenEditor ?? legacyServiceToken;

  const mkAdminHeaders = (token: string, kind: "admin" | "service"): Record<string, string> =>
    kind === "admin"
      ? {
          authorization: token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`,
          "x-admin-token": token,
        }
      : {
          // IMPORTANT: Do NOT also send Authorization for service tokens.
          // The web-backend may attempt JWT verification on Authorization first,
          // which can produce noisy TokenExpiredError logs (and in some stacks,
          // can short-circuit auth before checking x-service-token).
          "x-service-token": token,
        };

  const adminHeaders: Record<string, string> | undefined = adminToken ? mkAdminHeaders(adminToken, "admin") : undefined;
  const serviceHeadersReadonly: Record<string, string> | undefined = serviceTokenReadonly
    ? mkAdminHeaders(serviceTokenReadonly, "service")
    : undefined;
  const serviceHeadersEditor: Record<string, string> | undefined = serviceTokenEditor ? mkAdminHeaders(serviceTokenEditor, "service") : undefined;

  // Prefer: human admin token, else readonly service token, else editor service token.
  const defaultAdminHeaders: Record<string, string> | undefined = adminHeaders ?? serviceHeadersReadonly ?? serviceHeadersEditor;

  const serviceRoleReadonly = serviceTokenReadonly?.startsWith("svc:") ? String(serviceTokenReadonly.split(":")[2] ?? "") : "";

  const adminSmoke: GoalDefinition[] = ctx?.webBackendHttpBase && defaultAdminHeaders
    ? (
        [
          {
            id: "admin.fixtures.time",
            kind: "http_json",
            url: `${ctx.webBackendHttpBase}/api/admin/test_fixtures/time`,
            requestHeaders: defaultAdminHeaders,
            expectStatus: 200,
            expectPath: "ok",
            expectValue: true,
            timeoutMs: 2000,
          },
          // NOTE: readonly service tokens are not allowed to exercise write-ish endpoints.
          // Use the deterministic GET ping variant instead so admin_smoke can stay green
          // under least privilege.
          (
            // If we only have a readonly service token (no human admin token and no editor token),
            // avoid write-ish pings by using the GET variant.
            !adminHeaders && serviceHeadersReadonly && serviceRoleReadonly === "readonly" && !serviceHeadersEditor
              ? ({
                  id: "admin.fixtures.ping",
                  kind: "http_json",
                  url: `${ctx.webBackendHttpBase}/api/admin/test_fixtures/ping`,
                  requestHeaders: defaultAdminHeaders,
                  expectStatus: 200,
                  expectPath: "pong",
                  expectValue: "pong",
                  timeoutMs: 2000,
                } satisfies GoalDefinition)
              : ({
                  id: "admin.fixtures.ping",
                  kind: "http_post_json",
                  url: `${ctx.webBackendHttpBase}/api/admin/test_fixtures/ping`,
                  requestHeaders: adminHeaders ?? serviceHeadersEditor ?? defaultAdminHeaders,
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
            requestHeaders: defaultAdminHeaders,
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


// MMO backend admin character lifecycle smoke (requires MOTHER_BRAIN_MMO_BACKEND_HTTP_BASE and a service token with editor/root role).
// Disabled by default unless env is set; safe for repeated runs (creates a temp character, renames, then deletes).
const mmoAdminSmoke: GoalDefinition[] =
  ctx?.mmoBackendHttpBase && (ctx?.mmoBackendServiceTokenEditor ?? ctx?.mmoBackendServiceToken)
    ? ([
        {
          id: "admin.characters.smoke_cycle",
          kind: "http_post_json",
          url: `${ctx.mmoBackendHttpBase}/api/admin/characters/smoke_cycle`,
          requestHeaders: {
            // IMPORTANT: service tokens must be sent via x-service-token.
            // Do not also send Authorization, as that can trigger JWT verification first.
            "x-service-token": `${ctx.mmoBackendServiceTokenEditor ?? ctx.mmoBackendServiceToken}`,
          },
          requestJson: {
            // NOTE: userId must be provided by your environment. For convenience, allow env override via MOTHER_BRAIN_TEST_USER_ID.
            userId: process.env.MOTHER_BRAIN_TEST_USER_ID ?? "",
            shardId: "prime_shard",
            classId: "pw_class_adventurer",
            namePrefix: "MB",
          },
          expectStatus: 200,
          expectPath: "ok",
          expectValue: true,
          timeoutMs: 5000,
          serviceRole: "editor",
        },
      ] satisfies GoalDefinition[])
    : ([] as GoalDefinition[]);


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
        { command: "help", expectIncludes: "Available commands:", rejectRegexAny: ["/\\[error\\]/i", "/unknown\\s+command/i"] },
        { command: "quest help", expectIncludes: "Quest Board", rejectRegexAny: ["/\\[error\\]/i", "/unknown\\s+command/i"] },
        { command: "attack", expectIncludes: "[combat] You are not engaged", rejectRegexAny: ["/\\[error\\]/i", "/unknown\\s+command/i"] },
        { command: "pet", expectIncludes: "[pet] Commands:", rejectRegexAny: ["/\\[error\\]/i", "/unknown\\s+command/i"] },
      ],
    },

    // Deeper (still read-only) player-facing checks. These are intentionally disabled by default
    // until command text/protocol is confirmed for your environment.
    {
      id: "ws.mud.quest.readonly",
      kind: "ws_mud_script",
      enabled: false,
      timeoutMs: 2500,
      retries: 1,
      retryDelayMs: 200,
      scriptDelayMs: 50,
      scriptStopOnFail: true,
      script: [
        // Prefer regex to reduce brittleness across formatting tweaks.
        { command: "quest help", expectRegexAny: ["Quest Board", "/quest\\s+board/i"] },
        { command: "quest board", expectRegexAny: ["Quest Board", "Quests", "/available\\s+quests/i"] },
        { command: "quests", expectRegexAny: ["Quests", "Active", "/no\\s+active/i"] },
      ],
    },


    // Optional: exercise the quest accept + abandon plumbing in a town context.
    // This goal is disabled by default because it requires the WS-attached character to be in a room
    // with a town quest board offering.
    //
    // It is designed to be safe: if there are no available quests, it stops early as OK.
    {
      id: "ws.mud.quest.accept_one_if_any",
      kind: "ws_mud_script",
      enabled: false,
      timeoutMs: 3000,
      retries: 1,
      retryDelayMs: 250,
      scriptDelayMs: 75,
      scriptStopOnFail: true,
      script: [
        {
          command: "quest board available",
          // Accept either "available quests" output or any "none here" variant.
          expectRegexAny: ["Available quests:", "No available quests.", "/no\\s+available\\s+quests/i", "/no\\s+quest\\s+board/i", "/not\\s+in\\s+a\\s+town/i"],
          rejectRegexAny: ["/\[error\]/i", "/unknown\s+command/i"],
          // If no quests (or no board) are available, end the script cleanly as OK.
          stopOkIfRegexAny: ["/no\\s+available\\s+quests/i", "/no\\s+quest\\s+board/i", "/not\\s+in\\s+a\\s+town/i"],
          // Capture the first available quest id from the rendered board line.
          // Example: "  1. [ ] Some Quest Name (quest_id)"
          captureRegex: "/^\s*\d+\.\s+\[ \]\s+(?:\[NEW\]\s+)?[^\(]*\(([^\)]+)\)/m",
          captureVar: "qid",
          captureGroup: 1,
        },
        {
          command: "quest board accept {{qid}}",
          expectRegexAny: ["\[quest\] Accepted:"],
          rejectRegexAny: ["/\[error\]/i", "/unknown\s+command/i"],
          // Sometimes state persistence can race a tiny bit in dev.
          retries: 2,
          retryDelayMs: 200,
        },
        {
          command: "quest",
          expectRegexAny: ["\[A\]", "{{qid}}"],
          rejectRegexAny: ["/\[error\]/i"],
        },
        {
          command: "quest abandon {{qid}}",
          expectRegexAny: ["\[quest\] Abandoned:"],
          rejectRegexAny: ["/\[error\]/i", "/unknown\s+command/i"],
        },
      ],
    },

    {
      id: "ws.mud.player.profile.readonly",
      kind: "ws_mud_script",
      enabled: false,
      timeoutMs: 2500,
      retries: 1,
      retryDelayMs: 200,
      scriptDelayMs: 50,
      scriptStopOnFail: true,
      script: [
        { command: "stats", expectRegexAny: ["HP", "Level", "/str|dex|int/i"] },
        { command: "inventory", expectRegexAny: ["Inventory", "You are carrying", "/empty/i"] },
      ],
    },

    // Optional protocol/command dependent checks (disabled until confirmed).
    { id: "ws.mud.look", kind: "ws_mud", enabled: false, command: "look", expectIncludesAny: ["You see", "Exits", "Around you"], timeoutMs: 2500 },
    { id: "ws.mud.say", kind: "ws_mud", enabled: false, command: "say mother brain ping", expectIncludesAny: ["You say", "says"], timeoutMs: 2500 },
    { id: "ws.mud.move.north", kind: "ws_mud", enabled: false, command: "north", expectIncludesAny: ["You move", "You go", "You arrive", "Exits"], timeoutMs: 2500 },
  ];

  // "Playtester" pack: same as all_smoke, but enables a few safe player-facing scripts by default.
  // The enabled scripts are designed to stop-OK when prerequisites are missing (e.g. no quest board in the current room).
  const playtesterOverrides: GoalDefinition[] = [
    {
      id: "ws.mud.quest.accept_one_if_any",
      kind: "ws_mud_script",
      enabled: true,
      timeoutMs: 3000,
      retries: 1,
      retryDelayMs: 250,
      scriptDelayMs: 75,
      scriptStopOnFail: true,
      script: [
        {
          command: "quest board available",
          // Accept either "available quests" output or any "none here" variant.
          expectRegexAny: ["Available quests:", "No available quests.", "/no\\s+available\\s+quests/i", "/no\\s+quest\\s+board/i", "/not\\s+in\\s+a\\s+town/i"],
          rejectRegexAny: ["/\[error\]/i", "/unknown\s+command/i"],
          // If no quests (or no board) are available, end the script cleanly as OK.
          stopOkIfRegexAny: ["/no\\s+available\\s+quests/i", "/no\\s+quest\\s+board/i", "/not\\s+in\\s+a\\s+town/i"],
          // Capture the first available quest id from the rendered board line.
          // Example: "  1. [ ] Some Quest Name (quest_id)"
          captureRegex: "/^\s*\d+\.\s+\[ \]\s+(?:\[NEW\]\s+)?[^\(]*\(([^\)]+)\)/m",
          captureVar: "qid",
          captureGroup: 1,
        },
        {
          command: "quest board accept {{qid}}",
          expectRegexAny: ["\[quest\] Accepted:"],
          rejectRegexAny: ["/\[error\]/i", "/unknown\s+command/i"],
          retries: 2,
          retryDelayMs: 200,
        },
        { command: "quest", expectRegexAny: ["\[A\]", "{{qid}}"], rejectRegexAny: ["/\[error\]/i"] },
        { command: "quest abandon {{qid}}", expectRegexAny: ["\[quest\] Abandoned:"], rejectRegexAny: ["/\[error\]/i", "/unknown\s+command/i"] },
      ],
    },
    {
      id: "ws.mud.player.profile.readonly",
      kind: "ws_mud_script",
      enabled: true,
      timeoutMs: 2500,
      retries: 1,
      retryDelayMs: 200,
      scriptDelayMs: 50,
      scriptStopOnFail: true,
      script: [
        { command: "stats", expectRegexAny: ["HP", "Level", "/str|dex|int/i"] },
        { command: "inventory", expectRegexAny: ["Inventory", "You are carrying", "/empty/i"] },
      ],
    },

    // Safe quest loop: if there is a ready quest, attempt a turn-in.
    // Stops OK when there are no ready quests (or no quest board / not in town).
    {
      id: "ws.mud.quest.turnin_one_if_ready",
      kind: "ws_mud_script",
      enabled: true,
      timeoutMs: 3500,
      retries: 1,
      retryDelayMs: 250,
      scriptDelayMs: 100,
      scriptStopOnFail: true,
      script: [
        {
          command: "quest board ready",
          expectRegexAny: ["/Ready\\s+quests:/i", "/no\\s+ready\\s+quests/i", "/no\\s+quest\\s+board/i", "/not\\s+in\\s+a\\s+town/i"],
          rejectRegexAny: ["/\\[error\\]/i", "/unknown\\s+command/i"],
          stopOkIfRegexAny: ["/no\\s+ready\\s+quests/i", "/no\\s+quest\\s+board/i", "/not\\s+in\\s+a\\s+town/i"],
          // Capture first ready quest id.
          captureRegex: "/^\\s*\\d+\\.\\s+.*\\(([^\\)]+)\\)\\s*$/m",
          captureVar: "rqid",
          captureGroup: 1,
        },
        {
          command: "quest board turnin {{rqid}}",
          // Accept success or a reward selection prompt.
          expectRegexAny: ["/Turned\\s+in/i", "/Reward\\s+choice/i", "/Choose\\s+a\\s+reward/i", "/\\[quest\\].*reward/i"],
          rejectRegexAny: ["/\\[error\\]/i", "/unknown\\s+command/i"],
          // If rewards are required, stop OK here (do not auto-pick rewards).
          stopOkIfRegexAny: ["/Reward\\s+choice/i", "/Choose\\s+a\\s+reward/i"],
          retries: 1,
          retryDelayMs: 200,
        },
      ],
    },

    // Safe combat smoke: try to swing at a training dummy if present.
    // Stops OK if no dummy exists in the current room.
    {
      id: "ws.mud.combat.training_dummy.swing",
      kind: "ws_mud_script",
      enabled: true,
      timeoutMs: 3500,
      retries: 1,
      retryDelayMs: 250,
      scriptDelayMs: 100,
      scriptStopOnFail: true,
      script: [
        {
          command: "attack training dummy",
          stopOkIfRegexAny: ["/no\\s+training\\s+dummy/i", "/not\\s+here/i", "/cannot\\s+attack/i"],
          expectRegexAny: ["/you\\s+(?:attack|strike|hit)/i", "/combat\\s+started/i", "/already\\s+in\\s+combat/i"],
          rejectRegexAny: ["/\\[error\\]/i", "/unknown\\s+command/i"],
        },
        {
          command: "attack",
          expectRegexAny: ["/you\\s+(?:attack|strike|hit)/i", "/damage/i", "/absorbed/i"],
          rejectRegexAny: ["/\\[error\\]/i", "/unknown\\s+command/i"],
        },
      ],
    },
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

    // Playtester suite (defaults to enabling a few safe player-facing scripts).
    playtester: [...corePack, ...webSmoke, ...adminSmoke, ...mmoAdminSmoke, ...playerSmoke, ...playtesterOverrides],

    admin_smoke: [...adminSmoke, ...mmoAdminSmoke],
    web_smoke: webSmoke,

    // Convenience pack: combines core + web_smoke + admin_smoke + player_smoke.
    // Individual goals inside may be disabled (e.g. if MOTHER_BRAIN_WEB_BACKEND_HTTP_BASE is not set).
    all_smoke: [...corePack, ...webSmoke, ...adminSmoke, ...mmoAdminSmoke, ...playerSmoke],
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

function parseRegexString(pattern: string): RegExp | null {
  const s = pattern.trim();
  if (!s) return null;

  // Support a JS-like literal: /body/flags
  if (s.startsWith("/")) {
    const lastSlash = s.lastIndexOf("/");
    if (lastSlash > 0) {
      const body = s.slice(1, lastSlash);
      const flags = s.slice(lastSlash + 1);
      try {
        return new RegExp(body, flags);
      } catch {
        return null;
      }
    }
  }

  try {
    return new RegExp(s);
  } catch {
    return null;
  }
}


type TemplateVars = Record<string, string>;

function interpolateTemplate(raw: string, vars: TemplateVars): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = raw.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) {
      missing.push(name);
      return `{{${name}}}`;
    }
    return String(v);
  });
  return { text, missing };
}

function interpolateStringArray(arr: string[] | undefined, vars: TemplateVars): { arr?: string[]; missing: string[] } {
  if (!Array.isArray(arr) || arr.length === 0) return { arr, missing: [] };
  const missing: string[] = [];
  const out = arr.map((s) => {
    const r = interpolateTemplate(String(s), vars);
    missing.push(...r.missing);
    return r.text;
  });
  return { arr: out, missing };
}

function applyVarsToExpectations<T extends {
  expectIncludes?: string;
  expectIncludesAll?: string[];
  expectIncludesAny?: string[];
  rejectIncludes?: string;
  rejectIncludesAny?: string[];
  expectRegex?: string;
  expectRegexAll?: string[];
  expectRegexAny?: string[];
  rejectRegex?: string;
  rejectRegexAll?: string[];
  rejectRegexAny?: string[];
  stopOkIfIncludes?: string;
  stopOkIfIncludesAny?: string[];
  stopOkIfRegex?: string;
  stopOkIfRegexAny?: string[];
  stopOkIfRegexAll?: string[];
}>(src: T, vars: TemplateVars): { cooked: T; missing: string[] } {
  const missing: string[] = [];

  const e1 = src.expectIncludes ? interpolateTemplate(src.expectIncludes, vars) : null;
  if (e1) missing.push(...e1.missing);

  const r1 = src.rejectIncludes ? interpolateTemplate(src.rejectIncludes, vars) : null;
  if (r1) missing.push(...r1.missing);

  const a1 = interpolateStringArray(src.expectIncludesAll, vars); missing.push(...a1.missing);
  const a2 = interpolateStringArray(src.expectIncludesAny, vars); missing.push(...a2.missing);
  const a3 = interpolateStringArray(src.rejectIncludesAny, vars); missing.push(...a3.missing);

  const rx1 = src.expectRegex ? interpolateTemplate(src.expectRegex, vars) : null;
  if (rx1) missing.push(...rx1.missing);
  const rx2 = src.rejectRegex ? interpolateTemplate(src.rejectRegex, vars) : null;
  if (rx2) missing.push(...rx2.missing);

  const ra1 = interpolateStringArray(src.expectRegexAll, vars); missing.push(...ra1.missing);
  const ra2 = interpolateStringArray(src.expectRegexAny, vars); missing.push(...ra2.missing);
  const ra3 = interpolateStringArray(src.rejectRegexAll, vars); missing.push(...ra3.missing);
  const ra4 = interpolateStringArray(src.rejectRegexAny, vars); missing.push(...ra4.missing);

  const st1 = (src as any).stopOkIfIncludes ? interpolateTemplate(String((src as any).stopOkIfIncludes), vars) : null;
  if (st1) missing.push(...st1.missing);
  const stA1 = interpolateStringArray((src as any).stopOkIfIncludesAny, vars); missing.push(...stA1.missing);
  const stR1 = (src as any).stopOkIfRegex ? interpolateTemplate(String((src as any).stopOkIfRegex), vars) : null;
  if (stR1) missing.push(...stR1.missing);
  const stRAny = interpolateStringArray((src as any).stopOkIfRegexAny, vars); missing.push(...stRAny.missing);
  const stRAll = interpolateStringArray((src as any).stopOkIfRegexAll, vars); missing.push(...stRAll.missing);


  const cooked = {
    ...src,
    expectIncludes: e1 ? e1.text : src.expectIncludes,
    rejectIncludes: r1 ? r1.text : src.rejectIncludes,
    expectIncludesAll: a1.arr,
    expectIncludesAny: a2.arr,
    rejectIncludesAny: a3.arr,
    expectRegex: rx1 ? rx1.text : src.expectRegex,
    rejectRegex: rx2 ? rx2.text : src.rejectRegex,
    expectRegexAll: ra1.arr,
    expectRegexAny: ra2.arr,
    rejectRegexAll: ra3.arr,
    rejectRegexAny: ra4.arr,
    stopOkIfIncludes: st1 ? st1.text : (src as any).stopOkIfIncludes,
    stopOkIfIncludesAny: stA1.arr,
    stopOkIfRegex: stR1 ? stR1.text : (src as any).stopOkIfRegex,
    stopOkIfRegexAny: stRAny.arr,
    stopOkIfRegexAll: stRAll.arr,
  } as T;

  return { cooked, missing: Array.from(new Set(missing)) };
}

function validateMudExpectations(
  out: string,
  goal: {
    expectIncludes?: string;
    expectIncludesAll?: string[];
    expectIncludesAny?: string[];
    rejectIncludes?: string;
    rejectIncludesAny?: string[];
    expectRegex?: string;
    expectRegexAll?: string[];
    expectRegexAny?: string[];
    rejectRegex?: string;
    rejectRegexAll?: string[];
    rejectRegexAny?: string[];
  }
): string[] {
  const missing: string[] = [];

  // Negative expectations first: fail fast if output contains/matches forbidden patterns.
  if (goal.rejectIncludes) {
    if (out.includes(goal.rejectIncludes)) return [`reject:${goal.rejectIncludes}`];
  }

  if (Array.isArray(goal.rejectIncludesAny) && goal.rejectIncludesAny.length > 0) {
    const hit = goal.rejectIncludesAny.find((s) => out.includes(s));
    if (hit) return [`reject_any_of:${hit}`];
  }

  if (goal.rejectRegex) {
    const rx = parseRegexString(goal.rejectRegex);
    if (!rx) return [`bad_regex:${goal.rejectRegex}`];
    if (rx.test(out)) return [`reject_regex:${goal.rejectRegex}`];
  }

  if (Array.isArray(goal.rejectRegexAll) && goal.rejectRegexAll.length > 0) {
    for (const pat of goal.rejectRegexAll) {
      const rx = parseRegexString(pat);
      if (!rx) return [`bad_regex:${pat}`];
      if (rx.test(out)) return [`reject_regex:${pat}`];
    }
  }

  if (Array.isArray(goal.rejectRegexAny) && goal.rejectRegexAny.length > 0) {
    const hit = goal.rejectRegexAny.find((pat) => {
      const rx = parseRegexString(pat);
      return rx ? rx.test(out) : false;
    });
    if (hit) return [`reject_regex_any_of:${hit}`];
  }

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

  if (goal.expectRegex) {
    const rx = parseRegexString(goal.expectRegex);
    if (!rx) missing.push(`bad_regex:${goal.expectRegex}`);
    else if (!rx.test(out)) missing.push(`regex:${goal.expectRegex}`);
  }

  if (Array.isArray(goal.expectRegexAll) && goal.expectRegexAll.length > 0) {
    for (const pat of goal.expectRegexAll) {
      const rx = parseRegexString(pat);
      if (!rx) missing.push(`bad_regex:${pat}`);
      else if (!rx.test(out)) missing.push(`regex:${pat}`);
    }
  }

  if (Array.isArray(goal.expectRegexAny) && goal.expectRegexAny.length > 0) {
    const anyOk = goal.expectRegexAny.some((pat) => {
      const rx = parseRegexString(pat);
      return rx ? rx.test(out) : false;
    });
    if (!anyOk) missing.push(`regex_any_of:${goal.expectRegexAny.join("|")}`);
  }

  return missing;
}


function shouldStopScriptOk(out: string, step: {
  stopOkIfIncludes?: string;
  stopOkIfIncludesAny?: string[];
  stopOkIfRegex?: string;
  stopOkIfRegexAny?: string[];
  stopOkIfRegexAll?: string[];
}): boolean {
  if (step.stopOkIfIncludes && out.includes(step.stopOkIfIncludes)) return true;

  if (Array.isArray(step.stopOkIfIncludesAny) && step.stopOkIfIncludesAny.length > 0) {
    for (const s of step.stopOkIfIncludesAny) {
      if (typeof s === "string" && s.length > 0 && out.includes(s)) return true;
    }
  }

  const testRegex = (raw: string): boolean => {
    const rx = parseRegexString(raw);
    if (!rx) return false;
    return rx.test(out);
  };

  if (step.stopOkIfRegex && testRegex(step.stopOkIfRegex)) return true;

  if (Array.isArray(step.stopOkIfRegexAny) && step.stopOkIfRegexAny.length > 0) {
    for (const raw of step.stopOkIfRegexAny) {
      if (typeof raw === "string" && raw.length > 0 && testRegex(raw)) return true;
    }
  }

  if (Array.isArray(step.stopOkIfRegexAll) && step.stopOkIfRegexAll.length > 0) {
    for (const raw of step.stopOkIfRegexAll) {
      if (typeof raw !== "string" || raw.length === 0) return false;
      if (!testRegex(raw)) return false;
    }
    return true;
  }

  return false;
}



export function resolveGoalPacks(
  packIds: string[],
  ctx?: { webBackendHttpBase?: string; webBackendAdminToken?: string; webBackendServiceToken?: string; mmoBackendHttpBase?: string; mmoBackendServiceToken?: string }
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
  webBackendServiceTokenReadonly?: string;
  webBackendServiceTokenEditor?: string;

  mmoBackendHttpBase?: string;
  mmoBackendServiceToken?: string;
  mmoBackendServiceTokenReadonly?: string;
  mmoBackendServiceTokenEditor?: string;
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
    webBackendServiceTokenReadonly: args.webBackendServiceTokenReadonly,
    webBackendServiceTokenEditor: args.webBackendServiceTokenEditor,
    mmoBackendHttpBase: args.mmoBackendHttpBase,
    mmoBackendServiceToken: args.mmoBackendServiceToken,
    mmoBackendServiceTokenReadonly: args.mmoBackendServiceTokenReadonly,
    mmoBackendServiceTokenEditor: args.mmoBackendServiceTokenEditor,
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
      webBackendServiceTokenReadonly: state.webBackendServiceTokenReadonly,
      webBackendServiceTokenEditor: state.webBackendServiceTokenEditor,
      mmoBackendHttpBase: state.mmoBackendHttpBase,
      mmoBackendServiceToken: state.mmoBackendServiceToken,
      mmoBackendServiceTokenReadonly: state.mmoBackendServiceTokenReadonly,
      mmoBackendServiceTokenEditor: state.mmoBackendServiceTokenEditor,
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

function safeWriteJson(filePath: string, obj: unknown): void {
  try {
    ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // ignore
  }
}

function lastReportFilePath(state: GoalsState): string | undefined {
  if (!state.reportDir) return undefined;
  return path.resolve(state.reportDir, "mother-brain-goals-last.json");
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

      const elapsedMs = Date.now() - start;
      const budgetMs = typeof goal.maxLatencyMs === "number" ? Math.max(0, Math.floor(goal.maxLatencyMs)) : null;
      const okWithBudget = budgetMs !== null ? (ok && elapsedMs <= budgetMs) : ok;
      const budgetError =
        budgetMs !== null && ok && elapsedMs > budgetMs ? `latency_exceeded:${elapsedMs}>${budgetMs}` : undefined;

      if (okWithBudget) okCount += 1;
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
          rejectIncludes: goal.rejectIncludes,
          rejectIncludesAny: goal.rejectIncludesAny,
          expectRegex: goal.expectRegex,
          expectRegexAny: goal.expectRegexAny,
          expectRegexAll: goal.expectRegexAll,
          rejectRegex: goal.rejectRegex,
          rejectRegexAny: goal.rejectRegexAny,
          rejectRegexAll: goal.rejectRegexAll,
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

      const goalRetries = Math.max(0, Math.min(10, goal.retries ?? 2));
      const goalBaseDelayMs = Math.max(0, Math.min(10_000, goal.retryDelayMs ?? 200));
      const stepDelayMs = Math.max(0, Math.min(10_000, goal.scriptDelayMs ?? 0));
      const stopOnFail = goal.scriptStopOnFail !== false;

      const stepReports: any[] = [];
      const vars: TemplateVars = {
        ...(goal.scriptVars && typeof goal.scriptVars === "object" ? goal.scriptVars : {}),
      };
      let overallOk = true;

      for (let i = 0; i < script.length; i += 1) {
        const step = script[i];
        const optional = step.optional === true;
        const rawCmd = String(step.command ?? "").trim();
        const cmdInterp = interpolateTemplate(rawCmd, vars);
        const cmd = cmdInterp.text.trim();
        if (cmdInterp.missing.length > 0) {
          stepReports.push({
            index: i,
            command: rawCmd,
            ok: optional,
            optionalFailed: optional,
            hardFail: !optional,
            error: optional ? undefined : `missing vars: ${cmdInterp.missing.join(", ")}`,
            optionalError: optional ? `missing vars: ${cmdInterp.missing.join(", ")}` : undefined,
          });
          if (!optional) {
            overallOk = false;
            if (stopOnFail) break;
          }
          continue;
        }
        if (!cmd) {
          stepReports.push({
            index: i,
            command: "",
            ok: optional,
            optionalFailed: optional,
            hardFail: !optional,
            error: optional ? undefined : "missing command",
            optionalError: optional ? "missing command" : undefined,
          });
          if (!optional) {
            overallOk = false;
            if (stopOnFail) break;
          }
          continue;
        }

        const timeoutMs = step.timeoutMs ?? goal.timeoutMs ?? 2500;

        let res: { ok: boolean; output?: string; error?: string } = { ok: false, error: "not attempted" };
        let out = "";
        let ok = false;

        const retries = Math.max(0, Math.min(10, step.retries ?? goalRetries));
        const baseDelayMs = Math.max(0, Math.min(10_000, step.retryDelayMs ?? goalBaseDelayMs));

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

        const cookedExp = applyVarsToExpectations(step, vars);
        if (cookedExp.missing.length > 0) {
          ok = false;
          res = { ok: false, error: `missing vars: ${cookedExp.missing.join(", ")}` };
        }

        const missing = ok ? validateMudExpectations(out, cookedExp.cooked) : [];
        if (missing.length > 0) ok = false;

        // Capture variable from output for later steps.
        if (ok && step.captureRegex && step.captureVar) {
          const rx = parseRegexString(step.captureRegex);
          if (!rx) {
            ok = false;
            res = { ok: false, error: `bad_regex:${step.captureRegex}` };
          } else {
            const m = out.match(rx);
            if (!m) {
              ok = false;
              res = { ok: false, error: `capture_no_match:${step.captureRegex}` };
            } else {
              const group = Number.isFinite(step.captureGroup as any) ? Math.max(0, Math.floor(step.captureGroup as any)) : 1;
              const val = (m[group] ?? m[0] ?? "").toString();
              vars[step.captureVar] = val;
            }
          }
        }


        const stopOk = ok && shouldStopScriptOk(out, cookedExp.cooked as any);
        if (stopOk) {
          stepReports.push({
            index: i,
            command: cmd,
            ok: true,
            stoppedOk: true,
            outputPreview: out.length > 220 ? `${out.slice(0, 220)}…` : out,
            vars: Object.keys(vars).length > 0 ? { ...vars } : undefined,
          });
          // Script ends early as OK.
          break;
        }

        stepReports.push({
          index: i,
          command: cmd,
          ok: optional ? true : ok,
          optionalFailed: optional ? !ok : undefined,
          hardFail: optional ? false : !ok,
          error: optional
            ? undefined
            : ok
              ? undefined
              : res.error ?? (missing.length > 0 ? `missing expectation: ${missing.join(", ")}` : "failed"),
          optionalError:
            optional && !ok
              ? res.error ?? (missing.length > 0 ? `missing expectation: ${missing.join(", ")}` : "failed")
              : undefined,
          outputPreview: out.length > 220 ? `${out.slice(0, 220)}…` : out,
          expectIncludes: (cookedExp as any).cooked?.expectIncludes ?? step.expectIncludes,
          expectIncludesAny: (cookedExp as any).cooked?.expectIncludesAny ?? step.expectIncludesAny,
          expectIncludesAll: (cookedExp as any).cooked?.expectIncludesAll ?? step.expectIncludesAll,
          rejectIncludes: (cookedExp as any).cooked?.rejectIncludes ?? step.rejectIncludes,
          rejectIncludesAny: (cookedExp as any).cooked?.rejectIncludesAny ?? step.rejectIncludesAny,
          expectRegex: (cookedExp as any).cooked?.expectRegex ?? step.expectRegex,
          expectRegexAny: (cookedExp as any).cooked?.expectRegexAny ?? step.expectRegexAny,
          expectRegexAll: (cookedExp as any).cooked?.expectRegexAll ?? step.expectRegexAll,
          rejectRegex: (cookedExp as any).cooked?.rejectRegex ?? step.rejectRegex,
          rejectRegexAny: (cookedExp as any).cooked?.rejectRegexAny ?? step.rejectRegexAny,
          rejectRegexAll: (cookedExp as any).cooked?.rejectRegexAll ?? step.rejectRegexAll,
          captureRegex: step.captureRegex,
          captureVar: step.captureVar,
          captureGroup: step.captureGroup,
          retries: step.retries,
          retryDelayMs: step.retryDelayMs,
          delayAfterMs: step.delayAfterMs,
          optional,
          vars: Object.keys(vars).length > 0 ? { ...vars } : undefined,
        });

        if (!ok && !optional) {
          overallOk = false;
          if (stopOnFail) break;
        }

        const delayAfterMs = ok ? Math.max(0, Math.min(10_000, step.delayAfterMs ?? stepDelayMs)) : 0;
        if (delayAfterMs > 0 && i < script.length - 1) {
          await sleep(delayAfterMs);
        }
      }

      if (overallOk) okCount += 1;
      else failCount += 1;

      const firstFail = !overallOk
        ? stepReports.find((s) => s && typeof s === "object" && (s as any).hardFail === true)
        : null;
      const failMsg = firstFail
        ? `step ${(firstFail as any).index ?? "?"}: ${(firstFail as any).error ?? "failed"}`
        : "script failed";
      const stepFailCount = stepReports.filter((s) => s && typeof s === "object" && (s as any).hardFail === true).length;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok: overallOk,
        latencyMs: Date.now() - start,
        error: overallOk ? undefined : failMsg,
        details: {
          initialVars: goal.scriptVars && Object.keys(goal.scriptVars).length > 0 ? { ...goal.scriptVars } : undefined,
          steps: stepReports,
          stepCount: stepReports.length,
          stepFailCount,
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
      const elapsedMs = Date.now() - start;
      const budgetMs = typeof goal.maxLatencyMs === "number" ? Math.max(0, Math.floor(goal.maxLatencyMs)) : null;
      const okWithBudget = budgetMs !== null ? (ok && elapsedMs <= budgetMs) : ok;
      const budgetError =
        budgetMs !== null && ok && elapsedMs > budgetMs ? `latency_exceeded:${elapsedMs}>${budgetMs}` : undefined;

      if (okWithBudget) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok: okWithBudget,
        latencyMs: elapsedMs,
        error: okWithBudget ? undefined : (budgetError ?? res.error ?? `status ${res.status ?? "unknown"}`),
        details: {
          url,
          maxLatencyMs: goal.maxLatencyMs,
          elapsedMs,
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
      const elapsedMs = Date.now() - start;
      const budgetMs = typeof goal.maxLatencyMs === "number" ? Math.max(0, Math.floor(goal.maxLatencyMs)) : null;
      const okWithBudget = budgetMs !== null ? (ok && elapsedMs <= budgetMs) : ok;
      const budgetError = budgetMs !== null && ok && elapsedMs > budgetMs ? `latency_exceeded:${elapsedMs}>${budgetMs}` : undefined;

      if (okWithBudget) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok: okWithBudget,
        latencyMs: elapsedMs,
        error: okWithBudget ? undefined : (budgetError ?? res.error ?? `status ${res.status ?? "unknown"}`),
        details: {
          maxLatencyMs: goal.maxLatencyMs,
          elapsedMs,
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
      const elapsedMs = Date.now() - start;
      const budgetMs = typeof goal.maxLatencyMs === "number" ? Math.max(0, Math.floor(goal.maxLatencyMs)) : null;
      const okWithBudget = budgetMs !== null ? (ok && elapsedMs <= budgetMs) : ok;
      const budgetError =
        budgetMs !== null && ok && elapsedMs > budgetMs ? `latency_exceeded:${elapsedMs}>${budgetMs}` : undefined;

      if (okWithBudget) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok: okWithBudget,
        latencyMs: elapsedMs,
        error: okWithBudget ? undefined : (budgetError ?? res.error ?? `status ${res.status ?? "unknown"}`),
        details: {
          maxLatencyMs: goal.maxLatencyMs,
          elapsedMs,
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

  // Convenience: always write a single "last run" report (human friendly), so operators
  // can quickly inspect the most recent outcome without hunting timestamps.
  const lastPath = lastReportFilePath(state);
  if (lastPath) {
    safeWriteJson(lastPath, {
      ts: overall.ts,
      tick: overall.tick,
      ok: overall.ok,
      summary: overall.summary,
      bySuite,
      failingGoalsBySuite: state.lastFailingGoalsBySuite ?? null,
    });
  }

  return { ok: overallOk, bySuite, overall };
}