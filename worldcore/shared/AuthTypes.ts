// worldcore/shared/AuthTypes.ts

// Shared auth/identity model for Planar War.
//
// Used by:
//  - Webend backend (HTTP auth, account management)
//  - MMO shard backend (WS attach, permissions)
//  - Future MUD / web client
//
// This file is *pure types* – no DB or crypto. Those live in
// worldcore/auth/* and specific backends (webend, auth-service).

// Stable identifier aliases
export type UserId = string;       // global account id
export type CharacterId = string;  // per-shard character id
export type ShardId = string;      // "prime_shard", "pocket_udm_01", ...

// Bitfield-ish object that describes what an account can do.
// All optional so we can evolve over time.
export interface AccountFlags {
  /** True for normal players; you can treat "no flags set" as player too. */
  isPlayer?: boolean;

  /** Volunteer event-runner / RP role, below GM. */
  isGuide?: boolean;

  /** Classic GM – can moderate, teleport, fix players, etc. */
  isGM?: boolean;

  /** Developer: has heavy debug tools but not necessarily "everything". */
  isDev?: boolean;

  /** Top-tier owner/event host – CAN summon anything in the game. */
  isOwner?: boolean;

  /** Optional future knobs. */
  isTester?: boolean;
  isShardBuilder?: boolean; // future: shard builder / creator program
}

// High-level account record shape as seen by game backends.
export interface AccountProfile {
  id: UserId;
  displayName: string;       // what we show in chat by default
  email?: string;            // optional; not exposed to game clients
  createdAt: string;
  flags: AccountFlags;

  // Future: region/locale, preferences, etc.
}

// Minimal character summary used in selection screens and UIs.
export interface CharacterSummary {
  id: CharacterId;
  shardId: ShardId;

  name: string;
  classId: string;
  level: number;

  // World position snapshot (for resume/MUD/etc).
  lastWorldX: number;
  lastWorldY: number;
  lastWorldZ: number;
  lastRegionId?: string;

  // Visual / cosmetic tags (used by client, not logic).
  appearanceTag?: string;
}

// Payload stored in a signed auth token (JWT or similar).
// This is what the MMO shard / webend trusts after verification.
export interface AuthTokenPayload {
  sub: UserId;       // subject (user id)
  displayName: string;
  flags: AccountFlags;

  // Optional: shard-targeted session
  shardId?: ShardId;
  characterId?: CharacterId;

  // Issued-at and expiry timestamps (seconds since epoch).
  iat: number;
  exp: number;
}

// High-level auth result used by login endpoints.
export interface AuthResult {
  account: AccountProfile;
  token: string;           // signed token string
  expiresAt: number;       // ms since epoch for convenience
}

// How game backends will see an attached session.
export interface AttachedIdentity {
  userId: UserId;
  displayName: string;
  flags: AccountFlags;

  shardId?: ShardId;
  characterId?: CharacterId;
}

/**
 * Coarse staff role for quick checks.
 * (You can keep using flags directly if you prefer.)
 */
 export type StaffRole = "player" | "guide" | "gm" | "dev" | "owner";

 export const StaffRoleLevel: Record<StaffRole, number> = {
   player: 0,
   guide: 10,
   gm: 20,
   dev: 30,
   owner: 40,
 };
 
 export function getStaffRole(flags: AccountFlags | undefined): StaffRole {
   const f = flags || {};
   if (f.isOwner) return "owner";
   if (f.isDev) return "dev";
   if (f.isGM) return "gm";
   if (f.isGuide) return "guide";
   return "player";
 }
 
 export function getStaffTier(flags?: AccountFlags): number {
   return StaffRoleLevel[getStaffRole(flags)];
 }
 
 export function isGuide(flags?: AccountFlags): boolean {
   return getStaffTier(flags) >= StaffRoleLevel.guide;
 }
 export function isGMOrHigher(flags?: AccountFlags): boolean {
   return getStaffTier(flags) >= StaffRoleLevel.gm;
 }
 export function isDevOrHigher(flags?: AccountFlags): boolean {
   return getStaffTier(flags) >= StaffRoleLevel.dev;
 }
 export function isOwner(flags?: AccountFlags): boolean {
   return getStaffTier(flags) >= StaffRoleLevel.owner;
 }
  