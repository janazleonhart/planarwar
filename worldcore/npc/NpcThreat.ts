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

  // Debug-only breadcrumb: when a forced target is cleared early because it
  // became invalid (stealth/out-of-room/dead/etc), we keep a small note so
  // debug tooling can explain why the NPC suddenly swapped targets.
  forcedClearedAt?: number;
  forcedClearedReason?: string;
  forcedClearedTargetEntityId?: string;

  // New (v1.1.6): optional decay bookkeeping.
  // If present, callers may pass this state back in and decayThreat() can use it.
  lastDecayAt?: number;

  // New (v1.1.8): target stickiness to avoid coin-flip aggro swaps.
  lastSelectedTargetEntityId?: string;
  lastSelectedAt?: number;
}

export type CombatRole = "tank" | "healer" | "dps" | "unknown";

export interface ThreatValidity {
  ok: boolean;
  reason?: string;
}

export interface DecayThreatOpts {
  now?: number;
  // How many threat points to subtract per second.
  decayPerSec?: number;
  // Optional lower bound. If the remaining threat <= pruneBelow, remove the bucket.
  pruneBelow?: number;
  // If provided, uses (now - lastDecayAt) as dt; otherwise uses (now - (lastDecayAt ?? lastAggroAt ?? now)).
  lastDecayAt?: number;

  /**
   * Optional: returns the combat role for an entityId.
   * Used for role-aware decay policy (tanks hold threat longer, DPS decays faster).
   */
  getRoleForEntityId?: (entityId: string) => CombatRole | undefined;

  /**
   * Optional: validity predicate used to apply out-of-sight decay multipliers and
   * optionally prune invalid buckets.
   */
  validateTarget?: (entityId: string) => ThreatValidity;
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

const PW_THREAT_STICKY_MS_DEFAULT = Math.max(0, Math.floor(envNumber("PW_THREAT_STICKY_MS", 4000)));
const PW_THREAT_SWITCH_MARGIN_PCT_DEFAULT = Math.max(0, envNumber("PW_THREAT_SWITCH_MARGIN_PCT", 0.15));
const PW_THREAT_SWITCH_MARGIN_FLAT_DEFAULT = Math.max(0, envNumber("PW_THREAT_SWITCH_MARGIN_FLAT", 1));

const PW_ASSIST_AGGRO_WINDOW_MS_DEFAULT = Math.max(0, Math.floor(envNumber("PW_ASSIST_AGGRO_WINDOW_MS", 5000)));
const PW_ASSIST_MIN_TOP_THREAT_DEFAULT = envNumber("PW_ASSIST_MIN_TOP_THREAT", 1);

// If true, a stealthed player is immediately forgotten (threat bucket pruned) to prevent free tracking.
const PW_THREAT_FORGET_ON_STEALTH_DEFAULT = envBool("PW_THREAT_FORGET_ON_STEALTH", true);

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
  return selectThreatTarget(threat, now, () => ({ ok: true })).targetId;
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
  validateTarget: (entityId: string) => { ok: boolean; reason?: string },
): { targetId?: string; nextThreat?: NpcThreatState } {
  if (!threat) return { targetId: undefined, nextThreat: threat };

  let next: NpcThreatState | undefined = threat;

  const forcedId = threat.forcedTargetEntityId;
  const forcedUntil = typeof threat.forcedUntil === "number" ? threat.forcedUntil : undefined;
  const forcedActive = !!forcedId && typeof forcedUntil === "number" && now < forcedUntil;

  if (forcedActive && forcedId) {
    const v = validateTarget(forcedId);
    if (v.ok) {
      return { targetId: forcedId, nextThreat: threat };
    }

    // Forced target is no longer valid: clear the override so brains can recover.
    next = { ...threat };
    delete (next as any).forcedTargetEntityId;
    delete (next as any).forcedUntil;

    // Breadcrumb for debugging: explain why the forced window ended early.
    (next as any).forcedClearedAt = now;
    (next as any).forcedClearedReason = String(v.reason ?? "invalid");
    (next as any).forcedClearedTargetEntityId = forcedId;
  }

  const table = (next?.threatByEntityId ?? {}) as Record<string, number>;
  const entries = Object.entries(table)
    .map(([id, v]) => ({ id, v: typeof v === "number" ? v : 0 }))
    .filter((e) => e.v > 0)
    .sort((a, b) => {
      const dv = b.v - a.v;
      return dv !== 0 ? dv : String(a.id).localeCompare(String(b.id));
    });

  // Determine best valid candidate by threat.
  // If a candidate is invalid specifically due to stealth, we optionally forget it immediately
  // to prevent 'free tracking' where the NPC snaps back the instant stealth ends.
  const forgetOnStealth = PW_THREAT_FORGET_ON_STEALTH_DEFAULT;
  let tableMut: Record<string, number> | undefined = undefined;
  let tableChanged = false;

  let best: { id: string; v: number } | undefined;
  for (const e of entries) {
    const v = validateTarget(e.id);
    if (v.ok) {
      best = e;
      break;
    }

    if (forgetOnStealth && String(v.reason ?? "") === "stealth") {
      // Lazily clone the table only if we actually need to mutate it.
      if (!tableMut) tableMut = shallowCopyThreat((next as any)?.threatByEntityId);
      if (tableMut && e.id in tableMut) {
        delete tableMut[e.id];
        tableChanged = true;
      }

      // Also clear back-compat pointers if they refer to this hidden target.
      if ((next as any)?.lastAttackerEntityId === e.id) {
        next = { ...(next as any), lastAttackerEntityId: undefined } as any;
      }
      if ((next as any)?.lastSelectedTargetEntityId === e.id) {
        next = { ...(next as any), lastSelectedTargetEntityId: undefined, lastSelectedAt: undefined } as any;
      }
    }
  }

  if (tableChanged) {
    next = { ...(next as any), threatByEntityId: tableMut ?? {} };
  }


  // Back-compat fallback if table empty or all invalid.
  if (!best && next?.lastAttackerEntityId && validateTarget(next.lastAttackerEntityId).ok) {
    best = { id: next.lastAttackerEntityId, v: getThreatValue(next, next.lastAttackerEntityId) };
  }

  // Stickiness: prefer the previously selected target for a short window unless a challenger
  // clearly exceeds it by a configurable margin. This prevents "coin flip" aggro when two
  // entities are trading tiny threat deltas each tick.
  const stickyMs = PW_THREAT_STICKY_MS_DEFAULT;
  const prevId = String((next as any)?.lastSelectedTargetEntityId ?? "").trim();
  const prevAt = typeof (next as any)?.lastSelectedAt === "number" ? (next as any).lastSelectedAt as number : 0;

  if (stickyMs > 0 && prevId && prevAt > 0 && now - prevAt <= stickyMs) {
    const prevValid = validateTarget(prevId).ok;
    if (prevValid) {
      const prevV = getThreatValue(next, prevId);

      // If we don't have a better candidate, keep prev.
      if (!best) {
        const chosen = prevId;
        const out: NpcThreatState = { ...(next as any), lastSelectedTargetEntityId: chosen, lastSelectedAt: now };
        return { targetId: chosen, nextThreat: out };
      }

      // If best is already prev, keep it.
      if (best.id === prevId) {
        const out: NpcThreatState = { ...(next as any), lastSelectedTargetEntityId: best.id, lastSelectedAt: now };
        return { targetId: best.id, nextThreat: out };
      }

      const pct = PW_THREAT_SWITCH_MARGIN_PCT_DEFAULT;
      const flat = PW_THREAT_SWITCH_MARGIN_FLAT_DEFAULT;

      const needFlat = prevV + flat;
      const needPct = prevV * (1 + pct);
      const threshold = Math.max(needFlat, needPct);

      // Only switch if the challenger clears the threshold. Otherwise keep prev.
      if (best.v < threshold) {
        const chosen = prevId;
        const out: NpcThreatState = { ...(next as any), lastSelectedTargetEntityId: chosen, lastSelectedAt: now };
        return { targetId: chosen, nextThreat: out };
      }
    }
  }

  if (best) {
    const out: NpcThreatState = { ...(next as any), lastSelectedTargetEntityId: best.id, lastSelectedAt: now };
    return { targetId: best.id, nextThreat: out };
  }

  // Nothing valid.
  const out: NpcThreatState = { ...(next as any), lastSelectedTargetEntityId: undefined, lastSelectedAt: now } as any;
  return { targetId: undefined, nextThreat: out };
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
  opts?: DecayThreatOpts,
): NpcThreatState | undefined {
  if (!current) return current;

  const now = opts?.now ?? nowMs();
  const decayPerSec =
    typeof opts?.decayPerSec === "number" && opts.decayPerSec > 0
      ? opts.decayPerSec
      : PW_THREAT_DECAY_PER_SEC_DEFAULT;
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

  // Policy knobs (read at call time so tests can set env after import).
  const roleTankMult = Math.max(0, envNumber("PW_THREAT_DECAY_ROLE_TANK_MULT", 0.6));
  const roleHealerMult = Math.max(0, envNumber("PW_THREAT_DECAY_ROLE_HEALER_MULT", 1.0));
  const roleDpsMult = Math.max(0, envNumber("PW_THREAT_DECAY_ROLE_DPS_MULT", 1.2));
  const roleUnknownMult = Math.max(0, envNumber("PW_THREAT_DECAY_ROLE_UNKNOWN_MULT", 1.0));

  const oosMult = Math.max(0, envNumber("PW_THREAT_DECAY_OUT_OF_SIGHT_MULT", 2.5));
  const pruneInvalid = envBool("PW_THREAT_PRUNE_INVALID_BUCKETS", true);

  const decBase = decayPerSec * wholeSec;

  const table = shallowCopyThreat(current.threatByEntityId);
  let any = false;

  const getRole = opts?.getRoleForEntityId;
  const validate = opts?.validateTarget;

  for (const [id, v] of Object.entries(table)) {
    const n = typeof v === "number" ? v : 0;
    if (n <= 0) {
      delete table[id];
      continue;
    }

    let mult = 1;

    // Role-aware decay.
    if (getRole) {
      const role = getRole(String(id)) ?? "unknown";
      if (role === "tank") mult *= roleTankMult;
      else if (role === "healer") mult *= roleHealerMult;
      else if (role === "dps") mult *= roleDpsMult;
      else mult *= roleUnknownMult;
    }

    // Out-of-sight (or otherwise invalid) targets decay harder, and may be pruned.
    if (validate) {
      const vv = validate(String(id));
      if (!vv.ok) {
        const reason = String(vv.reason ?? "");
        if (reason === "out_of_room" || reason === "missing") {
          mult *= oosMult;
        }

        if (pruneInvalid && (reason === "dead" || reason === "protected" || reason === "missing")) {
          delete table[id];
          continue;
        }
      }
    }

    const dec = decBase * mult;
    const nextV = clampNonNeg(n - dec);
    if (nextV <= pruneBelow) {
      delete table[id];
    } else {
      table[id] = nextV;
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