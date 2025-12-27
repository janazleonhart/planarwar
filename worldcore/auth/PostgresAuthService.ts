// worldcore/auth/PostgresAuthService.ts

import crypto from "crypto";
import jwt from "jsonwebtoken";

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import {
  AccountProfile,
  AccountFlags,
  AuthResult,
  AuthTokenPayload,
  UserId,
} from "../shared/AuthTypes";
import { AuthService } from "./AuthService";

const log = Logger.scope("AUTH");

// JWT secret + lifetime
const JWT_SECRET = process.env.PW_AUTH_JWT_SECRET || "99-weee99reee99-weeree99-reewee99";
const JWT_LIFETIME_SECONDS = Number(
  process.env.PW_AUTH_JWT_LIFETIME || 60 * 60 * 24 * 7
); // default 7 days

// ------------------------
// Password hashing helpers
// ------------------------

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password: string, salt: string): string {
  // PBKDF2 with SHA-256
  const iterations = 100_000;
  const keyLen = 32;
  const digest = "sha256";

  const hash = crypto
    .pbkdf2Sync(password, salt, iterations, keyLen, digest)
    .toString("hex");

  return `${iterations}:${digest}:${hash}`;
}

function verifyPassword(
  password: string,
  salt: string,
  storedHash: string
): boolean {
  const [iterStr, digest, hashHex] = storedHash.split(":");
  const iterations = Number(iterStr) || 100_000;
  const keyLen = Buffer.from(hashHex, "hex").length;

  const computed = crypto
    .pbkdf2Sync(password, salt, iterations, keyLen, digest)
    .toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hashHex, "hex"),
    Buffer.from(computed, "hex")
  );
}

// ------------------------
// Row mapping
// ------------------------

interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  flags: any;
  created_at: string;
  updated_at: string;
}

function rowToProfile(row: AccountRow): AccountProfile {
  const flags: AccountFlags = row.flags || {};
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    createdAt: row.created_at,
    flags,
  };
}

function makeTokenPayload(profile: AccountProfile): AuthTokenPayload {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    sub: profile.id,
    displayName: profile.displayName,
    flags: profile.flags,
    iat: nowSec,
    exp: nowSec + JWT_LIFETIME_SECONDS,
  };
}

function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET);
}

// ------------------------
// Implementation
// ------------------------

export class PostgresAuthService implements AuthService {
  async registerAccount(
    email: string,
    displayName: string,
    password: string,
    flags?: Partial<AccountFlags>
  ): Promise<AuthResult> {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = displayName.trim();

    const salt = generateSalt();
    const hash = hashPassword(password, salt);

    // We don’t enforce particular flag shapes here – that’s owned by AuthTypes
    const effectiveFlags: AccountFlags = {
      ...(flags ?? {}),
    } as AccountFlags;

    const flagsJson = JSON.stringify(effectiveFlags);

    const result = await db.query<AccountRow>(
      `
      INSERT INTO accounts (email, display_name, password_hash, password_salt, flags)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING *
      `,
      [trimmedEmail, trimmedName, hash, salt, flagsJson]
    );

    const row = result.rows[0];
    const profile = rowToProfile(row);
    const payload = makeTokenPayload(profile);
    const token = signToken(payload);

    log.success("Registered new account", {
      userId: profile.id,
      email: profile.email,
      displayName: profile.displayName,
    });

    return {
      account: profile,
      token,
      expiresAt: payload.exp * 1000,
    };
  }

  async loginWithPassword(
    emailOrName: string,
    password: string
  ): Promise<AuthResult> {
    const query = emailOrName.includes("@")
      ? "SELECT * FROM accounts WHERE email = $1"
      : "SELECT * FROM accounts WHERE display_name = $1";

    const result = await db.query<AccountRow>(query, [emailOrName.trim()]);

    if (result.rowCount === 0) {
      log.warn("Login failed: account not found", { emailOrName });
      throw new Error("invalid_credentials");
    }

    const row = result.rows[0];

    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      log.warn("Login failed: bad password", { userId: row.id });
      throw new Error("invalid_credentials");
    }

    const profile = rowToProfile(row);
    const payload = makeTokenPayload(profile);
    const token = signToken(payload);

    log.info("Login OK", {
      userId: profile.id,
      displayName: profile.displayName,
    });

    return {
      account: profile,
      token,
      expiresAt: payload.exp * 1000,
    };
  }

  async verifyToken(token: string): Promise<AuthTokenPayload | null> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
      return decoded;
    } catch (err) {
      log.warn("Token verification failed", { err: String(err) });
      return null;
    }
  }

  async getAccountById(id: UserId): Promise<AccountProfile | null> {
    const result = await db.query<AccountRow>(
      "SELECT * FROM accounts WHERE id = $1",
      [id]
    );
    if (result.rowCount === 0) return null;
    return rowToProfile(result.rows[0]);
  }
}
