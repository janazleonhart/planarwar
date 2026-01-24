// web-backend/middleware/adminAuth.ts
//
// Option A: secure admin tools by requiring a valid auth token AND an admin flag.
// - Sends 401 if missing/invalid token
// - Sends 403 if token is valid but user is not an admin
//
// This middleware is intentionally "thin": it relies on worldcore's PostgresAuthService
// as the source of truth for token verification and account flags.

import type { Request, Response, NextFunction } from "express";
import { PostgresAuthService } from "../../worldcore/auth/PostgresAuthService";

const auth = new PostgresAuthService();

export type AuthedRequest = Request & {
  auth?: Awaited<ReturnType<PostgresAuthService["verifyToken"]>>;
};

function parseBearerToken(req: Request): string | null {
  const raw = (req.headers["authorization"] || req.headers["Authorization"]) as string | string[] | undefined;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

function isAdminFlag(flags: any): boolean {
  // flags is jsonb; keep this permissive but explicit.
  if (!flags || typeof flags !== "object") return false;
  return flags.admin === true || flags.isAdmin === true || flags.role === "admin";
}

export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "missing_token" });
    }

    const payload = await auth.verifyToken(token);
    if (!payload) {
      return res.status(401).json({ ok: false, error: "invalid_token" });
    }

    req.auth = payload;

    if (!isAdminFlag((payload as any).flags)) {
      return res.status(403).json({ ok: false, error: "admin_required" });
    }

    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "auth_error" });
  }
}

// For UI/dev convenience: allow bypassing admin auth in dev if explicitly enabled.
// Set PW_ADMIN_BYPASS=1 to bypass. Defaults to OFF.
export function maybeRequireAdmin(_mountPath: string) {
  const bypass = String(process.env.PW_ADMIN_BYPASS || "").trim();
  if (bypass === "1" || bypass.toLowerCase() === "true") {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  return requireAdmin;
}

// Compatibility alias (older code may import { requireAdminAuth }).
export const requireAdminAuth = requireAdmin;

export default requireAdmin;
