// worldcore/combat/StatusStackingPolicy.ts
//
// Status stacking policies define how repeated applications of the *same stacking group*
// behave.
//
// This module is deliberately boring: it is the "rules of the universe" layer.
// The fun happens when spells opt into a policy.

export type StatusStackingPolicy =
  /**
   * Backwards-compatible historical behavior:
   * - Exactly one active instance per stacking group
   * - Re-application adds stacks (clamped) and extends expiry to the later of (existing, new)
   */
  | "legacy_add"
  /**
   * Exactly one active instance per stacking group.
   * Re-application refreshes/extends duration, but does not increase stacks.
   */
  | "refresh"
  /**
   * Exactly one active instance per stacking group.
   * Re-application adds stacks (clamped) and refreshes/extends duration.
   */
  | "stack_add"
  /**
   * Multiple instances may exist in the same stacking group, capped by maxStacks.
   *
   * Intended gameplay rule:
   * - Different *versions* (spell upgrades) can coexist
   * - But only if they come from different appliers (casters)
   * - There is at most one active instance per versionKey
   * - There is at most one active instance per appliedById
   */
  | "versioned_by_applier";

export function isStatusStackingPolicy(v: unknown): v is StatusStackingPolicy {
  return v === "legacy_add" || v === "refresh" || v === "stack_add" || v === "versioned_by_applier";
}

export function resolveStatusStackingPolicy(
  v: unknown,
  fallback: StatusStackingPolicy,
): StatusStackingPolicy {
  return isStatusStackingPolicy(v) ? v : fallback;
}
