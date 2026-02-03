// worldcore/npc/NpcThreat.ts

/**
 * Threat / aggro bookkeeping for NPCs.
 *
 * v1 (previous): tracked only lastAttackerEntityId + lastAggroAt.
 * v2 (this slice): adds a lightweight threat table + taunt override, while
 * keeping v1 fields intact for backwards compatibility.
 *
 * Design goals:
 * - Deterministic, testable behavior (pure functions).
 * - Back-compat: existing brains/tests that only look at lastAttacker keep working.
 * - Minimal surface area: the combat pipeline can feed damage numbers, but callers
 *   can also feed small increments (eg: 1) when damage isn't available.
 */

export interface NpcThreatState {
  // Back-compat fields (used by existing brains/tests)
  lastAttackerEntityId?: string;
  lastAggroAt?: number;

  // New: additive threat table (higher = more likely target)
  threatByEntityId?: Record<string, number>;

  // New: taunt/forced-target override
  forcedTargetEntityId?: string;
  forcedUntil?: number;
}

function nowMs(): number {
  return Date.now();
}

function clampNonNeg(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

function shallowCopyThreat(threat?: Record<string, number>): Record<string, number> {
  return { ...(threat ?? {}) };
}

/**
 * Update threat when an NPC takes damage (or is otherwise provoked).
 *
 * - Adds `threatAmount` to the attacker's threat bucket.
 * - Updates back-compat `lastAttackerEntityId` + `lastAggroAt`.
 */
export function updateThreatFromDamage(
  current: NpcThreatState | undefined,
  attackerEntityId: string,
  threatAmount: number = 1,
  now: number = nowMs(),
): NpcThreatState {
  const amt = clampNonNeg(threatAmount);
  const next: NpcThreatState = { ...(current ?? {}) };

  next.lastAttackerEntityId = attackerEntityId;
  next.lastAggroAt = now;

  const table = shallowCopyThreat(next.threatByEntityId);
  table[attackerEntityId] = clampNonNeg((table[attackerEntityId] ?? 0) + amt);
  next.threatByEntityId = table;

  return next;
}

/**
 * Apply a taunt: temporarily force the NPC to consider `taunterEntityId` the
 * current target, and ensure its threat is >= current top threat.
 */
export function applyTauntToThreat(
  current: NpcThreatState | undefined,
  taunterEntityId: string,
  opts?: {
    durationMs?: number;
    threatBoost?: number;
    now?: number;
  },
): NpcThreatState {
  const now = opts?.now ?? nowMs();
  const durationMs =
    typeof opts?.durationMs === "number" && opts.durationMs > 0
      ? Math.floor(opts.durationMs)
      : 4000;

  const threatBoost =
    typeof opts?.threatBoost === "number" && opts.threatBoost > 0
      ? opts.threatBoost
      : 1;

  let next = updateThreatFromDamage(current, taunterEntityId, 0, now);
  const table = shallowCopyThreat(next.threatByEntityId);

  // Keep the underlying threat table stable: taunt is a *forced target override*.
  // We optionally allow a small bump, but we never let taunt permanently steal top threat.
  // This guarantees that when taunt expires, normal top-threat targeting resumes deterministically.
  let maxOther = 0;
  for (const [id, v] of Object.entries(table)) {
    if (id === taunterEntityId) continue;
    if (typeof v === "number" && v > maxOther) maxOther = v;
  }

  // Ensure the taunter key exists (even if 0).
  const currentTaunterThreat = typeof table[taunterEntityId] === "number" ? table[taunterEntityId] : 0;
  table[taunterEntityId] = currentTaunterThreat;

  if (threatBoost > 0) {
    const desired = currentTaunterThreat + threatBoost;
    // Cap strictly below the current max so expiry returns to prior top threat.
    const cap = maxOther > 0 ? maxOther - 0.001 : 0;
    table[taunterEntityId] = clampNonNeg(Math.min(desired, cap));
  }

  next.threatByEntityId = table;

  next.forcedTargetEntityId = taunterEntityId;
  next.forcedUntil = now + durationMs;

  // Also set back-compat lastAttacker to taunter so older brains behave well.
  next.lastAttackerEntityId = taunterEntityId;
  next.lastAggroAt = now;

  return next;
}

/**
 * Returns the current "best" target by threat.
 *
 * Priority:
 * 1) forced target if active
 * 2) highest threat bucket
 * 3) lastAttackerEntityId (back-compat)
 */
export function getTopThreatTarget(
  threat?: NpcThreatState,
  now: number = nowMs(),
): string | undefined {
  if (!threat) return undefined;

  if (
    threat.forcedTargetEntityId &&
    typeof threat.forcedUntil === "number" &&
    now < threat.forcedUntil
  ) {
    return threat.forcedTargetEntityId;
  }

  const table = threat.threatByEntityId ?? {};
  let bestId: string | undefined;
  let best = -1;

  for (const [id, v] of Object.entries(table)) {
    const n = typeof v === "number" ? v : 0;
    if (n > best) {
      best = n;
      bestId = id;
    }
  }

  return bestId ?? threat.lastAttackerEntityId;
}

/**
 * Back-compat accessor used by older AI/tests.
 */
export function getLastAttackerFromThreat(
  threat?: NpcThreatState,
): string | undefined {
  return threat?.lastAttackerEntityId;
}

export function getThreatValue(
  threat: NpcThreatState | undefined,
  entityId: string,
): number {
  const table = threat?.threatByEntityId ?? {};
  const v = table[entityId];
  return typeof v === "number" && v > 0 ? v : 0;
}
