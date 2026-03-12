//web-backend/routes/adminMotherBrain/motherBrainReports.ts

import fs from "node:fs/promises";
import path from "node:path";

import { toInt } from "./motherBrainShared";

export type GoalsReportTailResult = {
  ok: boolean;
  status: number;
  json: any;
};

export function motherBrainGoalsReportDir(): string | null {
  const explicit = typeof process.env.PW_MOTHER_BRAIN_GOALS_REPORT_DIR === "string" ? process.env.PW_MOTHER_BRAIN_GOALS_REPORT_DIR.trim() : "";
  if (explicit) return explicit;

  const filelog = typeof process.env.PW_FILELOG === "string" ? process.env.PW_FILELOG.trim() : "";
  if (!filelog) return null;

  const base = path.dirname(filelog);
  return path.join(base, "mother-brain");
}

export function safeSuiteId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

export async function readGoalsReportTail(args: { suiteQuery: unknown; linesQuery: unknown }): Promise<GoalsReportTailResult> {
  const reportDir = motherBrainGoalsReportDir();
  if (!reportDir) {
    return {
      ok: false,
      status: 409,
      json: {
        ok: false,
        error: "mother_brain_goals_report_dir_not_configured",
        detail: "Set PW_MOTHER_BRAIN_GOALS_REPORT_DIR or PW_FILELOG on web-backend to enable JSONL tail viewing.",
      },
    };
  }

  const suite = safeSuiteId(args.suiteQuery);
  if (!suite) {
    return {
      ok: false,
      status: 400,
      json: {
        ok: false,
        error: "suite_required",
        detail: "Provide suite=<suiteId> (letters/numbers/_/- only).",
      },
    };
  }

  const lines = Math.max(1, Math.min(500, toInt(args.linesQuery) ?? 200));
  const date = new Date().toISOString().slice(0, 10);
  const filename = `mother-brain-goals-${suite}-${date}.jsonl`;
  const full = path.join(reportDir, filename);

  try {
    const txt = await fs.readFile(full, "utf8");
    const all = txt.split(/\r?\n/).filter((line) => line.trim() !== "");
    const tail = all.slice(Math.max(0, all.length - lines));

    const parsed: any[] = [];
    for (const line of tail) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        parsed.push({ _parseError: true, line });
      }
    }

    return {
      ok: true,
      status: 200,
      json: { ok: true, suite, date, filename, lines: parsed },
    };
  } catch (err: any) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return {
        ok: false,
        status: 404,
        json: { ok: false, error: "report_not_found", detail: `${filename} not found in ${reportDir}` },
      };
    }

    return {
      ok: false,
      status: 500,
      json: { ok: false, error: err instanceof Error ? err.message : String(err) },
    };
  }
}
