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

export type GoalKind = "db_table_exists" | "db_wave_budget_breaches" | "ws_connected" | "ws_mud" | "http_get";

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

  // ws_mud
  command?: string;
  expectIncludes?: string;

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

  lastRunIso: string | null;
  lastOk: boolean | null;
  lastSummary: GoalRunReport["summary"] | null;

  // Per-suite status (only populated when packs are used)
  lastBySuite?: Record<
    string,
    {
      ok: boolean;
      summary: GoalRunReport["summary"];
    }
  >;

  // If set via HTTP, overrides file goals until cleared.
  inMemoryGoals: GoalDefinition[] | null;
};

export type GoalsHealth = {
  status: "OK" | "FAIL" | "STALE";
  lastRunIso: string | null;
  ageSec: number | null;
  overall?: {
    ok: boolean | null;
    summary: GoalRunReport["summary"] | null;
  };
  suites?: {
    total: number;
    ok: number;
    fail: number;
    failingSuites: string[];
  };
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
      command: typeof o.command === "string" ? o.command : undefined,
      expectIncludes: typeof o.expectIncludes === "string" ? o.expectIncludes : undefined,
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
  | "player_smoke";

export function builtinGoalPacks(): Record<GoalPackId, GoalDefinition[]> {
  return {
    core: [
      { id: "db.service_heartbeats.exists", kind: "db_table_exists", table: "service_heartbeats" },
      { id: "db.spawn_points.exists", kind: "db_table_exists", table: "spawn_points" },
      { id: "wave_budget.no_breaches", kind: "db_wave_budget_breaches", maxBreaches: 0 },
      { id: "ws.connected", kind: "ws_connected" },
    ],
    db: [
      { id: "db.service_heartbeats.exists", kind: "db_table_exists", table: "service_heartbeats" },
      { id: "db.spawn_points.exists", kind: "db_table_exists", table: "spawn_points" },
    ],
    wave_budget: [{ id: "wave_budget.no_breaches", kind: "db_wave_budget_breaches", maxBreaches: 0 }],
    ws: [{ id: "ws.connected", kind: "ws_connected" }],
    player_smoke: [
      // Requires WS to be configured for an authenticated character session.
      { id: "ws.mud.whereami", kind: "ws_mud", command: "whereami", expectIncludes: "You are", timeoutMs: 2500 },
    ],
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

export function resolveGoalPacks(packIds: string[]): { goals: GoalDefinition[]; unknown: string[] } {
  const packs = builtinGoalPacks();
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
}): GoalsState {
  const reportDir = args.reportDir;

  return {
    filePath: args.filePath,
    reportDir,
    everyTicks: args.everyTicks,
    packIds: normalizePackIds(args.packIds),
    lastRunIso: null,
    lastOk: null,
    lastSummary: null,
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
    const packs = builtinGoalPacks();
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

  const bySuite = state.lastBySuite;
  let suites: GoalsHealth["suites"] | undefined = undefined;
  if (bySuite && typeof bySuite === "object") {
    const entries = Object.entries(bySuite);
    const failingSuites = entries.filter(([, v]) => v?.ok === false).map(([k]) => k);
    suites = {
      total: entries.length,
      ok: entries.filter(([, v]) => v?.ok === true).length,
      fail: failingSuites.length,
      failingSuites,
    };
  }

  return {
    status,
    lastRunIso,
    ageSec,
    overall: { ok: lastOk, summary: state.lastSummary },
    ...(suites ? { suites } : {}),
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

async function httpGet(url: string, timeoutMs: number): Promise<{ ok: boolean; status?: number; error?: string }> {
  // Node 18+ global fetch.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    return { ok: res.ok, status: res.status };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
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
      const res = await deps.wsMudCommand(command, timeoutMs);
      let ok = res.ok;
      const out = res.output ?? "";
      if (ok && goal.expectIncludes) {
        ok = out.includes(goal.expectIncludes);
      }

      if (ok) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok,
        latencyMs: Date.now() - start,
        error: ok
          ? undefined
          : res.error ?? (goal.expectIncludes ? `missing substring: ${goal.expectIncludes}` : "failed"),
        details: {
          command,
          expectIncludes: goal.expectIncludes,
          outputPreview: out.length > 400 ? `${out.slice(0, 400)}…` : out,
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

      const res = await httpGet(url, timeoutMs);
      const ok = res.ok && (expectStatus ? res.status === expectStatus : true);
      if (ok) okCount += 1;
      else failCount += 1;

      results.push({
        id: goal.id,
        kind: goal.kind,
        ok,
        latencyMs: Date.now() - start,
        error: res.ok ? undefined : res.error ?? `status ${res.status ?? "unknown"}`,
        details: { url, status: res.status, expectStatus },
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
    Object.entries(bySuite).map(([id, r]) => [id, { ok: r.ok, summary: r.summary }])
  );

  // Keep the legacy fields as the overall view.
  state.lastRunIso = overall.ts;
  state.lastOk = overall.ok;
  state.lastSummary = overall.summary;

  return { ok: overallOk, bySuite, overall };
}
