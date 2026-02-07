// worldcore/npc/NpcThreat.ts

/**
 * Threat / aggro bookkeeping for NPCs.
 *
 * v1 (previous): tracked only lastAttackerEntityId + lastAggroAt.
 * v2 (this slice): adds a lightweight threat table + taunt override, while
 * keeping v1 fields intact for backwards compatibility.
 * v3 (v1.1.6): adds deterministic threat decay + assist heuristics.
 *
 * Design goals:
 * - Deterministic, testable behavior (pure functions).
 * - Back-compat: existing brains/tests that only look at lastAttacker keep working.
 * - Minimal surface area: callers can feed damage numbers, but can also feed small
 *   increments (eg: 1) when damage isn't available.
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
  // Optional: last taunt application timestamp (used for taunt immunity windows).
  lastTauntAt?: number;

  // New (v1.1.6): optional decay bookkeeping.
  // If present, callers may pass this state back in and decayThreat() can use it.
  lastDecayAt?: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = String((process.env as any)?.[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = String((process.env as any)?.[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1","true","yes","y","on"].includes(raw)) return true;
  if (["0","false","no","n","off"].includes(raw)) return false;
  return fallback;
}

const PW_THREAT_DECAY_PER_SEC_DEFAULT = envNumber("PW_THREAT_DECAY_PER_SEC", 1);
const PW_THREAT_PRUNE_BELOW_DEFAULT = envNumber("PW_THREAT_PRUNE_BELOW", 0);

const PW_ASSIST_AGGRO_WINDOW_MS_DEFAULT = Math.max(0, Math.floor(envNumber("PW_ASSIST_AGGRO_WINDOW_MS", 5000)));
const PW_ASSIST_MIN_TOP_THREAT_DEFAULT = envNumber("PW_ASSIST_MIN_TOP_THREAT", 1);

// If true, taunt also forces the taunter to *take over* top threat (so expiry keeps target).
// If false (default), taunt is only a temporary forced-target override and will resume to prior top threat.
const PW_TAUNT_FORCE_TAKEOVER_DEFAULT = envBool("PW_TAUNT_FORCE_TAKEOVER", false);

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
  return addThreatValue(current, attackerEntityId, threatAmount, now, {
    setLastAttacker: true,
    lastAttackerEntityId: attackerEntityId,
  });
}

/**
 * Low-level helper: add threat to a bucket (after decay), optionally controlling
 * whether `lastAttackerEntityId` is updated.
 */
export function addThreatValue(
  current: NpcThreatState | undefined,
  entityId: string,
  threatAmount: number,
  now: number = nowMs(),
  opts?: {
    setLastAttacker?: boolean;
    lastAttackerEntityId?: string;
  },
): NpcThreatState {
  const amt = clampNonNeg(threatAmount);

  // Apply decay BEFORE we overwrite lastAggroAt for this new event.
  const decayed = decayThreat(current, { now });

  const next: NpcThreatState = { ...(decayed ?? {}) };

  // Always update lastAggroAt for any threat event.
  next.lastAggroAt = now;

  if (opts?.setLastAttacker) {
    next.lastAttackerEntityId = opts?.lastAttackerEntityId ?? entityId;
  }

  const table = shallowCopyThreat(next.threatByEntityId);
  table[entityId] = clampNonNeg((typeof table[entityId] === "number" ? table[entityId] : 0) + amt);
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
    forceTakeover?: boolean;
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
      : PW_ASSIST_MIN_TOP_THREAT_DEFAULT;

  const forceTakeover =
    typeof opts?.forceTakeover === "boolean" ? opts.forceTakeover : PW_TAUNT_FORCE_TAKEOVER_DEFAULT;

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

    if (forceTakeover) {
      // "Force" semantics: ensure taunter becomes actual top threat.
      table[taunterEntityId] = clampNonNeg(Math.max(desired, maxOther + threatBoost));
    } else {
      // Default semantics: taunt does NOT permanently steal top threat.
      // Cap strictly below the current max so expiry returns to prior top threat.
      const cap = maxOther > 0 ? maxOther - 0.001 : 0;
      table[taunterEntityId] = clampNonNeg(Math.min(desired, cap));
    }
  }

  next.threatByEntityId = table;

  next.forcedTargetEntityId = taunterEntityId;
  next.forcedUntil = now + durationMs;
  next.lastTauntAt = now;

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
  return selectThreatTarget(threat, now, () => true).targetId;
}

/**
 * Select a threat target with an external validity predicate.
 *
 * This is the "real" selector used by NPC brains so they can respect
 * visibility rules (stealth / out-of-room / dead targets) without baking those
 * concepts into the threat bookkeeping itself.
 *
 * Behavior:
 * - If a forced target is active AND valid => return it.
 * - If a forced target is active BUT invalid => clear the forced window and
 *   fall back to normal top-threat selection.
 * - Normal selection chooses the highest-threat valid entry.
 * - Back-compat fallback to lastAttackerEntityId if valid.
 */
export function selectThreatTarget(
  threat: NpcThreatState | undefined,
  now: number = nowMs(),
  isValidTarget: (entityId: string) => boolean,
): { targetId?: string; nextThreat?: NpcThreatState } {
  if (!threat) return { targetId: undefined, nextThreat: threat };

  let next: NpcThreatState | undefined = threat;

  const forcedId = threat.forcedTargetEntityId;
  const forcedUntil = typeof threat.forcedUntil === "number" ? threat.forcedUntil : undefined;
  const forcedActive = !!forcedId && typeof forcedUntil === "number" && now < forcedUntil;

  if (forcedActive && forcedId) {
    if (isValidTarget(forcedId)) {
      return { targetId: forcedId, nextThreat: threat };
    }

    // Forced target is no longer valid: clear the override so brains can recover.
    next = { ...threat };
    delete (next as any).forcedTargetEntityId;
    delete (next as any).forcedUntil;
  }

  const table = (next?.threatByEntityId ?? {}) as Record<string, number>;
  const entries = Object.entries(table)
    .map(([id, v]) => ({ id, v: typeof v === "number" ? v : 0 }))
    .filter((e) => e.v > 0)
    .sort((a, b) => b.v - a.v);

  for (const e of entries) {
    if (isValidTarget(e.id)) return { targetId: e.id, nextThreat: next };
  }

  if (next?.lastAttackerEntityId && isValidTarget(next.lastAttackerEntityId)) {
    return { targetId: next.lastAttackerEntityId, nextThreat: next };
  }

  return { targetId: undefined, nextThreat: next };
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

/**
 * Deterministically decay a threat table.
 *
 * This is intentionally linear + caller-driven so it can be used in both:
 * - tick-based systems (call with now timestamps)
 * - action-based systems (call before choosing targets)
 */
export function decayThreat(
  current: NpcThreatState | undefined,
  opts?: {
    now?: number;
    // How many threat points to subtract per second.
    decayPerSec?: number;
    // Optional lower bound. If the remaining threat <= pruneBelow, remove the bucket.
    pruneBelow?: number;
    // If provided, uses (now - lastDecayAt) as dt; otherwise uses (now - (lastDecayAt ?? lastAggroAt ?? now)).
    lastDecayAt?: number;
  },
): NpcThreatState | undefined {
  if (!current) return current;

  const now = opts?.now ?? nowMs();
  const decayPerSec = typeof opts?.decayPerSec === "number" && opts.decayPerSec > 0 ? opts.decayPerSec : PW_THREAT_DECAY_PER_SEC_DEFAULT;
  const pruneBelow = typeof opts?.pruneBelow === "number" ? opts.pruneBelow : PW_THREAT_PRUNE_BELOW_DEFAULT;

  const baseLast =
    typeof opts?.lastDecayAt === "number"
      ? opts.lastDecayAt
      : typeof current.lastDecayAt === "number"
        ? current.lastDecayAt
        : typeof current.lastAggroAt === "number"
          ? current.lastAggroAt
          : now;

  const dtMs = Math.max(0, now - baseLast);

  // Whole-second decay only: avoid surprising micro-decay in tight loops/tests.
  const wholeSec = Math.floor(dtMs / 1000);
  if (wholeSec <= 0) {
    return current;
  }

  const dec = decayPerSec * wholeSec;

  const table = shallowCopyThreat(current.threatByEntityId);
  let any = false;

  for (const [id, v] of Object.entries(table)) {
    const n = typeof v === "number" ? v : 0;
    const next = clampNonNeg(n - dec);
    if (next <= pruneBelow) {
      delete table[id];
    } else {
      table[id] = next;
      any = true;
    }
  }

  const next: NpcThreatState = { ...current };
  next.threatByEntityId = any ? table : {};
  // Preserve remainder milliseconds by advancing baseLast by whole seconds.
  next.lastDecayAt = baseLast + wholeSec * 1000;

  return next;
}

/**
 * Decide whether an NPC should assist an ally (join combat).
 *
 * Returns the entityId to assist against if eligible, otherwise undefined.
 *
 * This function is pure and makes no assumptions about spatial relationships;
 * callers should ensure the ally is actually "nearby" (same room, etc).
 */
export function getAssistTargetForAlly(
  allyThreat: NpcThreatState | undefined,
  now: number = nowMs(),
  opts?: {
    // Ally must have been aggroed within this window.
    windowMs?: number;
    // Ally must have at least this much top threat.
    minTopThreat?: number;
  },
): string | undefined {
  if (!allyThreat) return undefined;

  const windowMs =
    typeof opts?.windowMs === "number" && opts.windowMs > 0
      ? Math.floor(opts.windowMs)
      : PW_ASSIST_AGGRO_WINDOW_MS_DEFAULT;
  const minTopThreat =
    typeof opts?.minTopThreat === "number" && opts.minTopThreat > 0
      ? opts.minTopThreat
      : 1;

  const lastAggro = typeof allyThreat.lastAggroAt === "number" ? allyThreat.lastAggroAt : 0;
  if (lastAggro <= 0) return undefined;
  if (now - lastAggro > windowMs) return undefined;

  // Forced target takes priority if active.
  const forced = getTopThreatTarget(allyThreat, now);
  if (!forced) return undefined;

  // Ensure ally is actually threatened enough.
  const top = getThreatValue(allyThreat, forced);
  if (top < minTopThreat) return undefined;

  return forced;
}
