//worldcore/auth/AuthService.ts

import {
    AccountProfile,
    AuthResult,
    AuthTokenPayload,
    UserId,
  } from "../shared/AuthTypes";

// Staff / account flags.
// NOTE: all optional so old rows / partial updates are safe.
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

  export interface AuthService {
    /**
     * Create a new account.
     * Throws if email or display_name is already taken.
     */
    registerAccount(
      email: string,
      displayName: string,
      password: string,
      flags?: Partial<AccountProfile["flags"]>
    ): Promise<AuthResult>;
  
    /**
     * Login by email or displayName + password.
     * Returns auth result with a signed token.
     */
    loginWithPassword(
      emailOrName: string,
      password: string
    ): Promise<AuthResult>;
  
    /**
     * Verify a token string and return the embedded payload,
     * or null if invalid/expired.
     */
    verifyToken(token: string): Promise<AuthTokenPayload | null>;
  
    /**
     * Fetch an account profile by id.
     */
    getAccountById(id: UserId): Promise<AccountProfile | null>;
  }
  