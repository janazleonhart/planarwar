// worldcore/pvp/DuelService.ts
//
// DuelService v0.1 (dormant PvP plumbing)
//
// Goals:
//  - Provide a tiny in-memory duel handshake (challenge/accept/decline/yield)
//  - Keep the rest of the combat math untouched
//  - Enable "duel mode" damage context without enabling open PvP
//
// Notes:
//  - This is intentionally ephemeral (memory-only). Persistence can come later.
//  - Requests expire quickly to avoid stale/ghost challenges.
//  - Active duels can be ended explicitly (yield) or by external events (death).

export type DuelEndReason = "yield" | "death" | "cancel" | "expired" | "disconnect";

export interface DuelRequest {
  fromCharId: string;
  toCharId: string;
  fromName: string;
  toName: string;
  roomId: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface ActiveDuel {
  aCharId: string;
  bCharId: string;
  aName: string;
  bName: string;
  roomId: string;
  startedAtMs: number;
}

export type DuelRequestResult =
  | { ok: true; request: DuelRequest }
  | { ok: false; reason: string };

export type DuelAcceptResult =
  | { ok: true; duel: ActiveDuel }
  | { ok: false; reason: string };

export type DuelEndResult =
  | { ok: true; duel: ActiveDuel; reason: DuelEndReason }
  | { ok: false; reason: string };

const DEFAULT_REQUEST_TTL_MS = 60_000; // 60s
const DEFAULT_DUEL_TTL_MS = 15 * 60_000; // 15 minutes safety valve

function keyPair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class DuelService {
  private readonly pendingByTarget = new Map<string, Map<string, DuelRequest>>();
  private readonly activeByPair = new Map<string, ActiveDuel>();
  private readonly activeByChar = new Map<string, ActiveDuel>();

  /** Remove expired requests and duels (safety valve). */
  tick(nowMs: number): void {
    // Pending cleanup
    for (const [toCharId, byFrom] of this.pendingByTarget) {
      for (const [fromCharId, req] of byFrom) {
        if (req.expiresAtMs <= nowMs) {
          byFrom.delete(fromCharId);
        }
      }
      if (byFrom.size === 0) this.pendingByTarget.delete(toCharId);
    }

    // Active duels safety-valve cleanup (rare)
    for (const [pairKey, duel] of this.activeByPair) {
      const started = duel.startedAtMs ?? 0;
      if (started > 0 && started + DEFAULT_DUEL_TTL_MS <= nowMs) {
        this.activeByPair.delete(pairKey);
        this.activeByChar.delete(duel.aCharId);
        this.activeByChar.delete(duel.bCharId);
      }
    }
  }

  /** Returns the active duel for this character, if any. */
  getActiveDuel(charId: string): ActiveDuel | null {
    return this.activeByChar.get(charId) ?? null;
  }

  /** Returns opponent charId if in an active duel. */
  getOpponentId(charId: string): string | null {
    const duel = this.activeByChar.get(charId);
    if (!duel) return null;
    return duel.aCharId === charId ? duel.bCharId : duel.aCharId;
  }

  isActiveBetween(aCharId: string, bCharId: string): boolean {
    const duel = this.activeByChar.get(aCharId);
    if (!duel) return false;
    return duel.aCharId === bCharId || duel.bCharId === bCharId;
  }

  listPendingForTarget(toCharId: string, nowMs: number): DuelRequest[] {
    this.tick(nowMs);
    const byFrom = this.pendingByTarget.get(toCharId);
    if (!byFrom) return [];
    return Array.from(byFrom.values()).sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  requestDuel(
    fromCharId: string,
    fromName: string,
    toCharId: string,
    toName: string,
    roomId: string,
    nowMs: number,
    ttlMs: number = DEFAULT_REQUEST_TTL_MS,
  ): DuelRequestResult {
    this.tick(nowMs);

    if (!fromCharId || !toCharId) {
      return { ok: false, reason: "Missing character id(s)." };
    }
    if (fromCharId === toCharId) {
      return { ok: false, reason: "You cannot duel yourself." };
    }
    if (this.getActiveDuel(fromCharId) || this.getActiveDuel(toCharId)) {
      return { ok: false, reason: "One of you is already in a duel." };
    }

    const byFrom = this.pendingByTarget.get(toCharId) ?? new Map<string, DuelRequest>();
    // prevent spam: existing unexpired request from same challenger
    const existing = byFrom.get(fromCharId);
    if (existing && existing.expiresAtMs > nowMs) {
      return { ok: false, reason: "You have already challenged that player (pending)." };
    }

    const req: DuelRequest = {
      fromCharId,
      toCharId,
      fromName: fromName || "Unknown",
      toName: toName || "Unknown",
      roomId,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
    };

    byFrom.set(fromCharId, req);
    this.pendingByTarget.set(toCharId, byFrom);

    return { ok: true, request: req };
  }

  declineDuel(toCharId: string, fromCharId: string, nowMs: number): DuelRequestResult {
    this.tick(nowMs);
    const byFrom = this.pendingByTarget.get(toCharId);
    if (!byFrom) return { ok: false, reason: "No pending duel request." };

    const req = byFrom.get(fromCharId);
    if (!req) return { ok: false, reason: "No pending duel request from that player." };

    byFrom.delete(fromCharId);
    if (byFrom.size === 0) this.pendingByTarget.delete(toCharId);

    return { ok: true, request: req };
  }

  acceptDuel(
    toCharId: string,
    fromCharId: string,
    roomId: string,
    nowMs: number,
  ): DuelAcceptResult {
    this.tick(nowMs);

    if (this.getActiveDuel(toCharId) || this.getActiveDuel(fromCharId)) {
      return { ok: false, reason: "One of you is already in a duel." };
    }

    const byFrom = this.pendingByTarget.get(toCharId);
    const req = byFrom?.get(fromCharId);
    if (!req) {
      return { ok: false, reason: "No pending duel request from that player." };
    }

    if (req.expiresAtMs <= nowMs) {
      // expired: cleanup and fail
      byFrom?.delete(fromCharId);
      if (byFrom && byFrom.size === 0) this.pendingByTarget.delete(toCharId);
      return { ok: false, reason: "That duel request has expired." };
    }

    if (req.roomId !== roomId) {
      return { ok: false, reason: "You must be in the same room to start a duel." };
    }

    // remove request
    byFrom?.delete(fromCharId);
    if (byFrom && byFrom.size === 0) this.pendingByTarget.delete(toCharId);

    const duel: ActiveDuel = {
      aCharId: req.fromCharId,
      bCharId: req.toCharId,
      aName: req.fromName,
      bName: req.toName,
      roomId,
      startedAtMs: nowMs,
    };

    const pairKey = keyPair(req.fromCharId, req.toCharId);
    this.activeByPair.set(pairKey, duel);
    this.activeByChar.set(req.fromCharId, duel);
    this.activeByChar.set(req.toCharId, duel);

    return { ok: true, duel };
  }

  /**
   * Accept the oldest pending request for this character.
   * Useful for plain "accept" with no name.
   */
  acceptAny(toCharId: string, roomId: string, nowMs: number): DuelAcceptResult {
    const list = this.listPendingForTarget(toCharId, nowMs);
    if (list.length === 0) return { ok: false, reason: "You have no pending duel requests." };
    // prefer oldest
    const oldest = list[0];
    return this.acceptDuel(toCharId, oldest.fromCharId, roomId, nowMs);
  }

  endDuelFor(charId: string, reason: DuelEndReason, nowMs: number): DuelEndResult {
    this.tick(nowMs);

    const duel = this.activeByChar.get(charId);
    if (!duel) return { ok: false, reason: "You are not in a duel." };

    const pairKey = keyPair(duel.aCharId, duel.bCharId);
    this.activeByPair.delete(pairKey);
    this.activeByChar.delete(duel.aCharId);
    this.activeByChar.delete(duel.bCharId);

    return { ok: true, duel, reason };
  }
}

export const DUEL_SERVICE = new DuelService();
