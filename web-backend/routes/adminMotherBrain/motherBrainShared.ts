// web-backend/routes/adminMotherBrain/motherBrainShared.ts

export function pgErrCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as { code?: unknown };
  return typeof anyErr.code === "string" ? anyErr.code : null;
}

export function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}
