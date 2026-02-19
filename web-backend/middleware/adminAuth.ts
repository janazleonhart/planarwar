// web-backend/middleware/adminAuth.ts
//
// Admin auth + RBAC (role-based access control)
//
// - Verifies Bearer token via worldcore's PostgresAuthService (source of truth)
// - Resolves admin role from accounts.flags:
//     flags.adminRole: "readonly" | "editor" | "root"
//   Back-compat fallback mapping:
//     flags.isDev   -> root
//     flags.isGM    -> editor
//     flags.isGuide -> readonly
//     flags.admin / flags.isAdmin / flags.role==="admin" -> editor
//
// - Enforces:
//   * readonly: GET/HEAD/OPTIONS only (no POST/PUT/PATCH/DELETE)
//   * editor: can write
//   * root: can write + can access root-only endpoints (below)
//
// Root-only endpoints (by URL path):
//   - POST /api/admin/spawn_points/bulk_delete
//   - POST /api/admin/spawn_points/mother_brain/wipe
//
// Dev bypass (explicit):
//   PW_ADMIN_BYPASS=1 (or "true") -> bypass all admin auth (OFF by default)

import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { PostgresAuthService } from "../../worldcore/auth/PostgresAuthService";

const auth = new PostgresAuthService();

export type AdminRole = "readonly" | "editor" | "root";

export type AdminContext = {
  role: AdminRole;
  flags: Record<string, any>;
};

export type AuthedRequest = Request & {
  auth?: Awaited<ReturnType<PostgresAuthService["verifyToken"]>>;
  admin?: AdminContext;
};

function parseBearerToken(req: Request): string | null {
  const raw = (req.headers["authorization"] || (req.headers as any)["Authorization"]) as
    | string
    | string[]
    | undefined;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return m ? m[1] : null;
}

function parseServiceToken(req: Request): string | null {
  const fromHeader = req.headers["x-service-token"];
  const h = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  if (typeof h === "string" && h.trim().length > 0) return h.trim();

  const bearer = parseBearerToken(req);
  if (!bearer) return null;

  // Service tokens are allowed to travel via Bearer as well.
  const s = String(bearer).trim();
  if (s.toLowerCase().startsWith("svc:") || s.toLowerCase().startsWith("service:")) return s;
  return null;
}

type VerifiedServiceToken = { serviceId: string; role: AdminRole };

function getServiceTokenSecrets(): string[] {
  // Rotation-friendly: prefer an explicit service secret, and allow one previous value.
  // Fallback to PW_AUTH_JWT_SECRET for dev convenience only.
  const active = (process.env.PW_SERVICE_TOKEN_SECRET || "").trim();
  const prev = (process.env.PW_SERVICE_TOKEN_SECRET_PREV || "").trim();
  const jwt = (process.env.PW_AUTH_JWT_SECRET || "").trim();

  const out: string[] = [];
  if (active) out.push(active);
  if (prev && prev !== active) out.push(prev);
  if (jwt && !out.includes(jwt)) out.push(jwt);
  return out;
}

function verifyServiceToken(token: string): VerifiedServiceToken | null {
  const secrets = getServiceTokenSecrets();
  if (secrets.length === 0) return null;

  // Format: svc:<serviceId>:<role>:<sighex>
  // - role: readonly|editor|root
  // - sighex: HMAC-SHA256(secret, `${serviceId}:${role}`) as hex
  const parts = token.split(":").map((p) => p.trim());
  if (parts.length < 3) return null;

  const prefix = parts[0]?.toLowerCase();
  if (prefix !== "svc" && prefix !== "service") return null;

  const serviceId = parts[1] || "";
  if (!/^[a-z0-9_-]{1,64}$/i.test(serviceId)) return null;

  let role: AdminRole = "readonly";
  let sigHex = "";

  if (parts.length === 3) {
    // svc:<serviceId>:<sighex> (role defaults to readonly)
    sigHex = parts[2] || "";
  } else {
    // svc:<serviceId>:<role>:<sighex>
    const maybeRole = normalizeAdminRole(parts[2]);
    if (!maybeRole) return null;
    role = maybeRole;
    sigHex = parts[3] || "";
  }

  if (!/^[a-f0-9]{64}$/i.test(sigHex)) return null;

  const msg = `${serviceId}:${role}`;

  // Accept any currently-valid secret (active, prev, or fallback).
  let ok = false;
  for (const secret of secrets) {
    const expected = crypto.createHmac("sha256", secret).update(msg).digest("hex");

    // Constant-time compare.
    try {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(sigHex, "hex");
      if (a.length !== b.length) continue;
      if (crypto.timingSafeEqual(a, b)) {
        ok = true;
        break;
      }
    } catch {
      // ignore
    }
  }

  if (!ok) return null;

  return { serviceId, role };
}

function normalizeAdminRole(v: any): AdminRole | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "readonly" || s === "editor" || s === "root") return s as AdminRole;
  return null;
}

function resolveAdminRole(flags: any): AdminRole | null {
  if (!flags || typeof flags !== "object") return null;

  // Canonical modern key
  const role = normalizeAdminRole((flags as any).adminRole);
  if (role) return role;

  // Back-compat + convenience fallbacks (existing world flags)
  if ((flags as any).isDev === true) return "root";
  if ((flags as any).isGM === true) return "editor";
  if ((flags as any).isGuide === true) return "readonly";

  // Older admin-ish flags (kept for compatibility)
  if ((flags as any).admin === true || (flags as any).isAdmin === true || (flags as any).role === "admin") {
    return "editor";
  }

  return null;
}

function isWriteMethod(method: string): boolean {
  const m = String(method || "").toUpperCase();
  // Treat OPTIONS as non-write for CORS/preflight sanity.
  return !(m === "GET" || m === "HEAD" || m === "OPTIONS");
}

// Full admin URL path matcher.
// We prefer req.baseUrl+req.path because requireAdmin is mounted per-router.
function getFullPath(req: Request): string {
  const base = String((req as any).baseUrl ?? "");
  const p = String((req as any).path ?? "");
  return `${base}${p}`;
}

// Root-only endpoint matchers.
// NOTE: keep this list small and explicit; it’s a scalpel, not a lawnmower.
const ROOT_ONLY_PATHS: RegExp[] = [
  /^\/api\/admin\/spawn_points\/bulk_delete$/i,
  /^\/api\/admin\/spawn_points\/mother_brain\/wipe$/i,
];

function isRootOnlyEndpoint(req: Request): boolean {
  const fullPath = getFullPath(req);
  return ROOT_ONLY_PATHS.some((re) => re.test(fullPath));
}

export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    // Service-token path (daemon/prod auth). If provided but invalid, fail fast.
    const serviceToken = parseServiceToken(req);
    if (serviceToken) {
      const verified = verifyServiceToken(serviceToken);
      if (!verified) {
        return res.status(401).json({ ok: false, error: "invalid_service_token" });
      }

      const flags = { adminRole: verified.role, isService: true, serviceId: verified.serviceId } as Record<string, any>;
      req.auth = {
        sub: `svc:${verified.serviceId}`,
        flags,
      } as any;

      req.admin = { role: verified.role, flags };

      // Enforce readonly gate: no writes.
      if (verified.role === "readonly" && isWriteMethod(req.method)) {
        return res.status(403).json({ ok: false, error: "admin_readonly" });
      }

      // Enforce root-only endpoints.
      if (isRootOnlyEndpoint(req) && verified.role !== "root") {
        return res.status(403).json({ ok: false, error: "admin_root_required" });
      }

      return next();
    }

    const token = parseBearerToken(req);
    if (!token) return res.status(401).json({ ok: false, error: "missing_token" });

    const payload = await auth.verifyToken(token);
    if (!payload) {
      return res.status(401).json({ ok: false, error: "invalid_token" });
    }

    req.auth = payload;

    const flags = ((payload as any).flags ?? {}) as Record<string, any>;
    const role = resolveAdminRole(flags);

    if (!role) {
      return res.status(403).json({ ok: false, error: "admin_required" });
    }

    req.admin = { role, flags };

    // Enforce readonly gate: no writes.
    if (role === "readonly" && isWriteMethod(req.method)) {
      return res.status(403).json({ ok: false, error: "admin_readonly" });
    }

    // Enforce root-only endpoints.
    if (isRootOnlyEndpoint(req) && role !== "root") {
      return res.status(403).json({ ok: false, error: "admin_root_required" });
    }

    return next();
  } catch (_err) {
    return res.status(401).json({ ok: false, error: "auth_error" });
  }
}

// For UI/dev convenience: allow bypassing admin auth in dev if explicitly enabled.
// Set PW_ADMIN_BYPASS=1 (or "true") to bypass. Defaults to OFF.
export function maybeRequireAdmin(_mountPath: string) {
  const bypass = String(process.env.PW_ADMIN_BYPASS || "").trim().toLowerCase();
  if (bypass === "1" || bypass === "true") {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  return requireAdmin;
}

// Compatibility alias (older code may import { requireAdminAuth }).
export const requireAdminAuth = requireAdmin;

export default requireAdmin;
